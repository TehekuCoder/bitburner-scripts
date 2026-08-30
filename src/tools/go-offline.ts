import { NS } from "@ns";
import { PATHS } from "../infrastructure/runtime/paths.js";
import { evaluateTargets, TargetScore } from "/domain/evaluators/strategy/target-selection.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  ns.tprint("🌙 Bereite Netzwerk auf Offline-Phase vor...");

  const workScript = PATHS.services.payloads.work;
  if (!ns.fileExists(workScript, "home")) {
    ns.tprint(`❌ ERROR: Worker-Skript '${workScript}' wurde nicht auf 'home' gefunden!`);
    return;
  }

  // 1. Alle anderen Skripte auf 'home' beenden
  const killedHomeCount = stopEverythingOnHome(ns);
  ns.tprint(`🧹 Home bereinigt: ${killedHomeCount} Skript(e) beendet.`);

  // 2. Erfasse alle nutzbaren Server im Netzwerk (inkl. Hacknet & Cloud)
  const servers = getAllRootedServersWithRam(ns);
  const totalNetworkRam = servers.reduce((sum, s) => sum + ns.getServerMaxRam(s), 0);

  // 3. Evaluierung der besten Ziele für die WORKER-Strategie
  const rankedTargets = evaluateTargets(ns, "WORKER");
  if (rankedTargets.length === 0) {
    ns.tprint("❌ ERROR: Keine gültigen Hacking-Ziele gefunden!");
    return;
  }

  // 4. Ziel-Anzahl dynamisch anhand des Gesamt-RAMs skalieren
  let maxTargets = 1;
  if (totalNetworkRam >= 4096) maxTargets = 6;
  else if (totalNetworkRam >= 2048) maxTargets = 4;
  else if (totalNetworkRam >= 512) maxTargets = 3;
  else if (totalNetworkRam >= 128) maxTargets = 2;

  const selectedTargets = rankedTargets.slice(0, Math.min(maxTargets, rankedTargets.length));
  const targetHostnames = selectedTargets.map((t) => t.hostname);

  // 5. Remote-Server bereinigen und Worker auf allen Servern bereitstellen
  const scriptRam = ns.getScriptRam(workScript, "home");
  let totalThreadsDeployed = 0;
  let serverCount = 0;

  for (let i = 0; i < servers.length; i++) {
    const server = servers[i];
    const maxRam = ns.getServerMaxRam(server);
    if (maxRam <= 0) continue;

    // Auf Remote-Servern alle alten Altlasten beenden
    if (server !== "home") {
      ns.killall(server);
    }

    // Auf 'home' lassen wir einen kleinen Sicherheitspuffer für manuelle Befehle/Tools
    let usableRam = maxRam;
    if (server === "home") {
      const reservedHomeRam = Math.min(32, maxRam * 0.1);
      usableRam = Math.max(0, maxRam - reservedHomeRam);
    }

    const threads = Math.floor(usableRam / scriptRam);
    if (threads <= 0) continue;

    // Skript auf Remote-Server kopieren
    if (server !== "home" && !ns.fileExists(workScript, server)) {
      ns.scp(workScript, server, "home");
    }

    // Round-Robin Verteilung der Top-Ziele über alle Server
    const assignedTarget = targetHostnames[i % targetHostnames.length];
    const pid = ns.exec(workScript, server, threads, assignedTarget);

    if (pid > 0) {
      totalThreadsDeployed += threads;
      serverCount++;
    }
  }

  // 6. Zusammenfassenden Bericht im Terminal ausgeben
  printSummaryReport(ns, selectedTargets, totalThreadsDeployed, serverCount, totalNetworkRam);
}

/**
 * Stoppt JEDES laufende Skript auf 'home' – außer der eigenen PID.
 */
function stopEverythingOnHome(ns: NS): number {
  const currentPid = ns.pid;
  const runningProcs = ns.ps("home");

  let stoppedCount = 0;
  for (const proc of runningProcs) {
    if (proc.pid !== currentPid) {
      ns.kill(proc.pid);
      stoppedCount++;
    }
  }

  return stoppedCount;
}

/**
 * Findet alle gerooteten Server im gesamten Netzwerk mit RAM > 0
 */
function getAllRootedServersWithRam(ns: NS): string[] {
  const visited = new Set<string>();
  const queue = ["home"];
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    visited.add(current);

    if (ns.hasRootAccess(current) && ns.getServerMaxRam(current) > 0) {
      result.push(current);
    }

    for (const neighbor of ns.scan(current)) {
      if (!visited.has(neighbor) && !queue.includes(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  return result;
}

/**
 * Gibt den Abschlussbericht direkt per tprint im Terminal aus.
 */
function printSummaryReport(
  ns: NS,
  targets: TargetScore[],
  totalThreads: number,
  serverCount: number,
  totalRam: number
): void {
  ns.tprint("==================================================");
  ns.tprint(" 🌙 OFFLINE-SETTING ERFOLGREICH AKTIVIERT");
  ns.tprint("==================================================");
  ns.tprint(` Aktive Worker-Server : ${serverCount}`);
  ns.tprint(` Gesamt-Threads       : ${ns.format.number(totalThreads, 0)}`);
  ns.tprint(` Genutztes Net-RAM    : ${ns.format.ram(totalRam)}`);
  ns.tprint("--------------------------------------------------");
  ns.tprint(" ZUGEWIESENE ZIELE (WORKER-SCORE):");

  targets.forEach((t, idx) => {
    ns.tprint(
      `  [${idx + 1}] ${t.hostname.padEnd(18)} | Max: $${ns.format.number(t.maxMoney, 2).padStart(10)} | Score: ${ns.format.number(t.score, 2)}`
    );
  });
  ns.tprint("==================================================");
}