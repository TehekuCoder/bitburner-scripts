import { NS } from "@ns";

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

    if (playerHackingLevel >= hackingLevelRequired && maxPossiblePorts >= portsRequired) {
      let portsOpened = 0;

      if (portsOpened < portsRequired && cricks.ssh.has) { cricks.ssh.run(server); portsOpened++; }
      if (portsOpened < portsRequired && cricks.ftp.has) { cricks.ftp.run(server); portsOpened++; }
      if (portsOpened < portsRequired && cricks.smtp.has) { cricks.smtp.run(server); portsOpened++; }
      if (portsOpened < portsRequired && cricks.http.has) { cricks.http.run(server); portsOpened++; }
      if (portsOpened < portsRequired && cricks.sql.has) { cricks.sql.run(server); portsOpened++; }

      if (portsOpened >= portsRequired) {
        ns.nuke(server);
        ns.scp(
          [
            "tasks/work.js",
            "tasks/xp-grind.js",
            "tasks/weaken.js",
            "tasks/grow.js",
            "tasks/hack.js",
          ],
          server,
          "home"
        );
        ns.print(`🔓 Server erfolgreich gehackt: ${server}`);
      }
    }
  }
}
/**
 * Findet das profitabelste Ziel für einfache Hack/Grow/Weaken-Worker.
 */
export function findBestFallbackTarget(
  ns: NS,
  hackingLevel: number,
  bnMults: any,
  allServers: string[],
  blacklistTarget: string | null = null,
): string {
  let bestTarget = "n00dles";
  let maxWeight = 0;

  const serverMaxMoneyMult = bnMults.ServerMaxMoney ?? 1.0;
  const growthMult = bnMults.ServerGrowthRate ?? 1.0;
  const isNoMoneyNode = serverMaxMoneyMult === 0;

  for (const current of allServers) {
    if (
      current === "home" ||
      !ns.hasRootAccess(current) ||
      current === blacklistTarget
    )
      continue;

    const reqHacking = ns.getServerRequiredHackingLevel(current);
    if (reqHacking > hackingLevel) continue;

    if (isNoMoneyNode) {
      const cycleTime = ns.getWeakenTime(current);
      const weight = reqHacking / (Math.max(1, cycleTime) / 1000);
      if (weight > maxWeight) {
        maxWeight = weight;
        bestTarget = current;
      }
      continue;
    }

    const serverMaxMoney = ns.getServerMaxMoney(current);
    if (serverMaxMoney <= 0) continue;

    const cycleTime = ns.getWeakenTime(current);
    if (cycleTime > 5 * 60 * 1000) continue; // Ignoriere extrem langsame Server im Early/Mid Game

    const weight =
      (serverMaxMoney / (cycleTime / 1000)) * (reqHacking / 100) * growthMult;

    if (weight > maxWeight) {
      maxWeight = weight;
      bestTarget = current;
    }
  }
  return bestTarget;
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