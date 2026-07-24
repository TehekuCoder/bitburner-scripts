import { NS, Player } from "@ns";
import { JitEvent } from "lib/types.js";
import { HOME_RAM_RESERVE } from "lib/constants.js";
import { provisionServer } from "/utils/provision";

/**
 * Durchsucht das gesamte Bitburner-Netzwerk via hochperformantem Stack (DFS).
 * Gibt ein Array mit ALLEN Servernamen im Spiel zurück. Performance: O(1) beim Pop.
 */
export function getAllServers(ns: NS): string[] {
  const visited = new Set<string>(["home"]);
  const stack = ["home"]; // Stack statt Queue spart das teure .shift()

  while (stack.length > 0) {
    const current = stack.pop()!; // O(1) Operation
    const connections = ns.scan(current);

    for (const nextServer of connections) {
      if (!visited.has(nextServer)) {
        visited.add(nextServer);
        stack.push(nextServer);
      }
    }
  }
  return Array.from(visited);
}

/**
 * Findet den exakten Verbindungspfad von 'home' zu einem Zielserver.
 */
export function findPathTo(
  ns: NS,
  target: string,
  current = "home",
  visited = new Set<string>(),
): string[] | null {
  visited.add(current);

  if (current === target) return [current];

  const connections = ns.scan(current);
  for (const next of connections) {
    if (visited.has(next)) continue;
    const path = findPathTo(ns, target, next, visited);
    if (path) return [current, ...path];
  }

  return null;
}

/**
 * Scannt das gesamte Netzwerk und bricht vollautomatisch alle Server auf.
 * Optimiert: Stoppt das Ausführen von Cracks, sobald die nötige Port-Anzahl erreicht ist.
 */
export function breakAndInfectNetwork(ns: NS): void {
  const allServers = getAllServers(ns);

  const cricks = {
    ssh: { has: ns.fileExists("BruteSSH.exe", "home"), run: ns.brutessh },
    ftp: { has: ns.fileExists("FTPCrack.exe", "home"), run: ns.ftpcrack },
    smtp: { has: ns.fileExists("relaySMTP.exe", "home"), run: ns.relaysmtp },
    http: { has: ns.fileExists("HTTPWorm.exe", "home"), run: ns.httpworm },
    sql: { has: ns.fileExists("SQLInject.exe", "home"), run: ns.sqlinject },
  };

  const maxPossiblePorts = Object.values(cricks).filter((c) => c.has).length;
  const playerHackingLevel = ns.getPlayer().skills.hacking;

  for (const server of allServers) {
    if (server === "home" || ns.hasRootAccess(server)) continue;

    const portsRequired = ns.getServerNumPortsRequired(server);
    const hackingLevelRequired = ns.getServerRequiredHackingLevel(server);

    if (
      playerHackingLevel >= hackingLevelRequired &&
      maxPossiblePorts >= portsRequired
    ) {
      let portsOpened = 0;

      if (portsOpened < portsRequired && cricks.ssh.has) {
        cricks.ssh.run(server);
        portsOpened++;
      }
      if (portsOpened < portsRequired && cricks.ftp.has) {
        cricks.ftp.run(server);
        portsOpened++;
      }
      if (portsOpened < portsRequired && cricks.smtp.has) {
        cricks.smtp.run(server);
        portsOpened++;
      }
      if (portsOpened < portsRequired && cricks.http.has) {
        cricks.http.run(server);
        portsOpened++;
      }
      if (portsOpened < portsRequired && cricks.sql.has) {
        cricks.sql.run(server);
        portsOpened++;
      }

      if (portsOpened >= portsRequired) {
        ns.nuke(server);
        provisionServer(ns, server); // Centralized Payload Deployment!
        ns.print(`🔓 Server erfolgreich gehackt & provisioniert: ${server}`);
      }
    }
  }
}
/**
 * Verteilt Threads eines Skripts auf alle verfügbaren Server im Netzwerk.
 */
export function dispatchSimpleTask(
  ns: NS,
  servers: string[],
  script: string,
  target: string,
  threads: number,
  bnMults: any,
): void {
  let threadsRemaining = threads;

  for (const server of servers) {
    if (!ns.hasRootAccess(server)) continue;
    if (ns.isRunning(script, server, target)) continue;

    const homeBuffer =
      bnMults.ServerWeakenRate < 1.0
        ? Math.ceil(48 / bnMults.ServerWeakenRate)
        : 48;
    const maxRam =
      server === "home"
        ? ns.getServerMaxRam("home") - homeBuffer
        : ns.getServerMaxRam(server);
    const freeRam = maxRam - ns.getServerUsedRam(server);
    const scriptRam = ns.getScriptRam(script);

    const possibleThreads = Math.floor(freeRam / scriptRam);

    if (possibleThreads > 0) {
      const threadsToRun = Math.min(possibleThreads, threadsRemaining);
      ns.exec(script, server, threadsToRun, target);

      if (threadsRemaining !== Infinity) {
        threadsRemaining -= threadsToRun;
        if (threadsRemaining <= 0) break;
      }
    }
  }
}

export function getNetworkMaxRam(ns: NS, servers: string[]): number {
  let total = servers
    .filter((s) => ns.hasRootAccess(s) && s !== "home")
    .reduce((sum, s) => sum + ns.getServerMaxRam(s), 0);

  total += Math.max(0, ns.getServerMaxRam("home") - HOME_RAM_RESERVE);
  return total;
}

export function getNetworkRealFreeRam(ns: NS, servers: string[]): number {
  let free = servers
    .filter((s) => ns.hasRootAccess(s) && s !== "home")
    .reduce(
      (sum, s) => sum + (ns.getServerMaxRam(s) - ns.getServerUsedRam(s)),
      0,
    );

  free += Math.max(
    0,
    ns.getServerMaxRam("home") - ns.getServerUsedRam("home") - HOME_RAM_RESERVE,
  );
  return free;
}

export function getQueueRam(ns: NS, queue: JitEvent[]): number {
  return queue.reduce(
    (sum, ev) => sum + ev.threads * ns.getScriptRam(ev.script),
    0,
  );
}

/**
 * Berechnet das profitabelste Hacking-Ziel im Netzwerk.
 */
export function findBestTarget(
  ns: NS,
  nodes: string[],
  playerHackingLevel: number,
  bnMults: any,
  blacklistTarget: string | null = null,
  maxCycleTimeMs: number = Infinity,
): string {
  let best = "n00dles";
  let maxWeight = 0;

  const serverMaxMoneyMult = bnMults?.ServerMaxMoney ?? 1.0;
  const growthMult = bnMults?.ServerGrowthRate ?? 1.0;
  const isNoMoneyNode = serverMaxMoneyMult === 0;

  for (const node of nodes) {
    // 1. System- & Infrastruktur-Server aussortieren
    if (
      node === "home" ||
      node === "darkweb" ||
      node.startsWith("hacknet-node") ||
      node === blacklistTarget ||
      !ns.hasRootAccess(node)
    ) {
      continue;
    }

    // 2. Hacking-Level Prüfung
    const reqSkill = ns.getServerRequiredHackingLevel(node);
    if (reqSkill > playerHackingLevel) continue;

    const cycleTime = ns.getWeakenTime(node);

    // 3. Optionaler Laufzeit-Filter (z. B. max 5 Minuten im Early/Mid-Game)
    if (maxCycleTimeMs < Infinity && cycleTime > maxCycleTimeMs) {
      continue;
    }

    // 4. Spezialfall: BitNodes ohne Geld (XP-Grind Fokus)
    if (isNoMoneyNode) {
      const weight = reqSkill / (Math.max(1, cycleTime) / 1000);
      if (weight > maxWeight) {
        maxWeight = weight;
        best = node;
      }
      continue;
    }

    // 5. Standard Geld-Gewichtung
    const maxMoney = ns.getServerMaxMoney(node);
    if (maxMoney <= 0) continue;

    const weight =
      (maxMoney / (cycleTime / 1000)) * (reqSkill / 100) * growthMult;

    if (weight > maxWeight) {
      maxWeight = weight;
      best = node;
    }
  }

  return best;
}