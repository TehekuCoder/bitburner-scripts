import { NS } from "@ns";
import { getAllServers } from "../lib/network.js";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js";
import { findBestFallbackTarget } from "../core/sys-dispatcher.js";

/** @param ns NS API Objekt */
export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  
  const p = ns.getPlayer();
  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;
  
  // 🎯 Ermittle das Ziel, das sys-dispatcher / go-offline wählen würden
  const bestTarget = findBestFallbackTarget(ns, p.skills.hacking, bnMults, null);
  
  const allServers = getAllServers(ns);
  const pServers = ns.cloud.getServerNames();
  const workerScript = "tasks/work.js";
  const workerRam = ns.getScriptRam(workerScript);

  // Filter analog zur go-offline Engine
  const targetServers = allServers.filter(
    s => s === "home" || pServers.includes(s) || (ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0)
  );

  let totalPotentialThreads = 0;
  let totalActiveThreads = 0;
  let wrongTargetThreads = 0;
  let currentRunningIncome = 0;

  for (const server of targetServers) {
    const reserve = server === "home" ? 32 : 0;
    const maxRam = ns.getServerMaxRam(server) - reserve;
    
    const activeProcesses = ns.ps(server);
    let shareRam = 0;

    // 1. Utility-RAM (Share-Skripte) analysieren
    for (const proc of activeProcesses) {
      if (proc.filename.includes("share")) {
        shareRam += ns.getScriptRam(proc.filename, server) * proc.threads;
      }
      
      // 2. Laufende Worker analysieren
      if (proc.filename === workerScript) {
        if (proc.args[0] === bestTarget) {
          totalActiveThreads += proc.threads;
          // Kumulierte Echtzeit-Einkommensrate der Engine abfragen
          currentRunningIncome += ns.getScriptIncome(workerScript, server, bestTarget);
        } else {
          wrongTargetThreads += proc.threads;
        }
      }
    }

    // 3. Potential berechnen (wieviele Threads könnten hier laufen?)
    const availableRamForWorker = maxRam - shareRam;
    const maxPossibleThreads = Math.max(0, Math.floor(availableRamForWorker / workerRam));
    totalPotentialThreads += maxPossibleThreads;
  }

  // UI Dashboard im Tail-Fenster ausgeben
  ns.clearLog();
  ns.ui.openTail();
  
  ns.print(`============================================================`);
  ns.print(`📊 BIT-OS: OFFLINE SYSTEM PRE-FLIGHT CHECK`);
  ns.print(`============================================================`);
  ns.print(`🎯 VISIERTES OFFLINE-ZIEL :  ${bestTarget}`);
  ns.print(`🧵 THREAD-AUSLASTUNG      :  ${totalActiveThreads} / ${totalPotentialThreads} Cores`);
  
  if (wrongTargetThreads > 0) {
    ns.print(`⚠️ FEHL-ALLOKATION        :  ${wrongTargetThreads} Threads auf falschem Ziel!`);
  }
  ns.print(`------------------------------------------------------------`);
  
  ns.print(`💰 ERWARTETE PRODUKTION (HOCHRECHNUNG):`);
  if (currentRunningIncome < 0) {
    ns.print(`   Ertrag / Sekunde       :  🚀 Hyper-Produktion (> $10q/s)`);
    ns.print(`   Ertrag / Stunde        :  🚀 Unendliche Kapazität`);
  } else {
    ns.print(`   Ertrag / Sekunde       :  $${ns.format.number(currentRunningIncome)} / s`);
    ns.print(`   Ertrag / Stunde        :  $${ns.format.number(currentRunningIncome * 3600)} / h`);
  }
  ns.print(`------------------------------------------------------------`);
  
  // 🚦 Live Status-Ampel für den Operator
  ns.print(`🚦 STATUS-ANALYSE:`);
  if (totalActiveThreads === 0) {
    ns.print(`   ❌ BEREITSCHAFT        :  SHUTDOWN ERFORDERLICH`);
    ns.print(`   👉 System-Hinweis      :  Führe 'run utils/go-offline.js' aus!`);
  } else if (wrongTargetThreads > 0 || totalActiveThreads < totalPotentialThreads * 0.9) {
    ns.print(`   ⚠️ BEREITSCHAFT        :  SUBOPTIMAL`);
    ns.print(`   👉 System-Hinweis      :  Netzwerk läuft asynchron. 'go-offline' erzwingen.`);
  } else if (currentRunningIncome === 0) {
    ns.print(`   ⏳ BEREITSCHAFT        :  KALIBRIERUNG LÄUFT (WARMUP)`);
    ns.print(`   👉 System-Hinweis      :  Skripte preppen noch. Bitte kurz warten.`);
  } else {
    ns.print(`   ✅ BEREITSCHAFT        :  BEREIT ZUM AUSLOGGEN (READY)`);
    ns.print(`   👉 System-Hinweis      :  Werte stabilisiert. Sichere Offline-Phase garantiert.`);
  }
  ns.print(`============================================================`);
}