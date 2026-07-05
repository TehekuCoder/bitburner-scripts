import { NS } from "@ns";
import { getAllServers } from "../lib/network.js";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js";
import { findBestFallbackTarget } from "../core/sys-dispatcher.js";
import { provisionServer } from "./provision.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.tprint("💤 [BitOS] Leite Schlafmodus ein. Fahre Core-Systeme herunter...");

  // 1. Stoppe alle Core-Systeme auf 'home', um RAM freizumachen und Deadlocks zu verhindern
  const coreScripts = [
    "core/sys-kernel.js",
    "core/sys-dispatcher.js",
    "core/sys-infra.js",
    "utils/fill-ram.js",
    "core/sys-batcher.js"
  ];

  for (const script of coreScripts) {
    if (ns.isRunning(script, "home")) {
      ns.scriptKill(script, "home");
      ns.print(`[SHUTDOWN] ${script} gestoppt.`);
    }
  }

  // Kurz warten, bis die Skripte den RAM freigegeben haben
  await ns.sleep(500);

  // 2. Bestimme das robusteste Ziel für die Offline-Phase
  const p = ns.getPlayer();
  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;
  const bestTarget = findBestFallbackTarget(ns, p.skills.hacking, bnMults, null);

  ns.tprint(`🎯 [BitOS] Offline-Target gewählt: ${bestTarget}`);

  // 3. Flute das gesamte infizierte Netzwerk mit zustandslosen Workern
  const allServers = getAllServers(ns);
  const pServers = ns.cloud.getServerNames();
  const workerScript = "tasks/work.js";
  const workerRam = ns.getScriptRam(workerScript);

  const targetServers = allServers.filter(
    s => s === "home" || pServers.includes(s) || (ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0)
  );

  for (const server of targetServers) {
    // Alle alten Worker/Batch-Reste auf dem Server killen
    ns.killall(server, server === "home"); // Wenn home, dann keine scripts killen, die wir brauchen (dieses hier läuft ja noch)
    if (server === "home") {
      // Auf home gezielt worker killen
      ns.scriptKill("tasks/hack.js", "home");
      ns.scriptKill("tasks/grow.js", "home");
      ns.scriptKill("tasks/weaken.js", "home");
      ns.scriptKill("tasks/share.js", "home");
      ns.scriptKill("tasks/xp-grind.js", "home");
    }

    // Sicherstellen, dass die Payload da ist
    await provisionServer(ns, server);

    // RAM berechnen (Puffer nur für home)
    const reserve = server === "home" ? 32 : 0; 
    const maxRam = ns.getServerMaxRam(server) - reserve;
    const freeRam = maxRam - ns.getServerUsedRam(server);
    const threads = Math.floor(freeRam / workerRam);

    if (threads > 0) {
      ns.exec(workerScript, server, threads, bestTarget);
      ns.print(`🚀 [OFFLINE-PREP] ${server} flutet ${bestTarget} mit ${threads} Threads.`);
    }
  }

  ns.tprint("🚀 [BitOS] SYSTEMBEREIT FÜR OFFLINE-PHASE. Du kannst das Spiel jetzt sicher schließen.");
}