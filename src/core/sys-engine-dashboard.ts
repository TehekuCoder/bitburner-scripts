import { NS } from "@ns";
import { drawEngineDashboard, EngineDashboardData } from "../ui/engine-ui.js";
import { getAllServers } from "/lib/network.js";
import { loadBatcherState } from "/lib/state.js";
import { PATHS } from "/lib/paths.js";
import { HOME_RAM_RESERVE } from "/lib/constants/batcher.js";

function detectEngineName(progressStr: string): string {
  if (progressStr.includes("PREP")) return "PREP";
  if (progressStr.includes("PROTO")) return "PROTO";
  if (progressStr.includes("SHOTGUN")) return "SHOTGUN";
  if (progressStr.includes("XP-GRIND")) return "XP-GRIND";
  return "STANDBY";
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.ui.setTailTitle("BIT-OS Engine Monitor");
  ns.ui.resizeTail(584, 556);

  const eventLog: string[] = [];
  let lastTarget = "";
  let lastEngineName = "";

  while (true) {
    const state = loadBatcherState(ns);

    if (!state || !state.batcherActive) {
      ns.clearLog();
      ns.print("============================================================");
      ns.print("🛰️ BIT-OS ENGINE MONITOR");
      ns.print("============================================================");
      ns.print("STATUS: Warten auf Aktivierung einer Engine im State...");
      ns.print("============================================================");
      await ns.sleep(1000);
      continue;
    }

    const target = state.batcherTarget ?? "Keines";
    const progressStr = state.batcherProgress ?? "";
    const engineName = detectEngineName(progressStr);

    // Event-Log Aktualisierungen bei Modus- oder Zielwechsel
    if (engineName !== lastEngineName && engineName !== "STANDBY") {
      eventLog.push(
        `[${new Date().toLocaleTimeString()}] ⚙️ Modus gewechselt: [${engineName}]`,
      );
      lastEngineName = engineName;
    }

    if (target !== lastTarget && target !== "Keines" && target !== "Suche...") {
      eventLog.push(
        `[${new Date().toLocaleTimeString()}] 🎯 Neues Fokus-Ziel: ${target}`,
      );
      lastTarget = target;
    }

    if (eventLog.length > 4) eventLog.shift();

    // 1. RAM-Pool Berechnung
    const servers = getAllServers(ns);
    let totalMaxRam = 0;
    let totalUsedRam = 0;

    let totalHack = 0;
    let totalGrow = 0;
    let totalWeaken = 0;

    for (const s of servers) {
      if (!ns.hasRootAccess(s)) continue;

      let max = ns.getServerMaxRam(s);
      if (s === "home") max = Math.max(0, max - HOME_RAM_RESERVE);

      totalMaxRam += max;
      totalUsedRam += ns.getServerUsedRam(s);

      // 2. Aktive In-Flight-Threads scannen
      for (const proc of ns.ps(s)) {
        if (
          proc.filename === PATHS.payloads.hack ||
          proc.filename.endsWith(PATHS.payloads.hack)
        ) {
          totalHack += proc.threads;
        } else if (
          proc.filename === PATHS.payloads.grow ||
          proc.filename.endsWith(PATHS.payloads.grow)
        ) {
          totalGrow += proc.threads;
        } else if (
          proc.filename === PATHS.payloads.weaken ||
          proc.filename.endsWith(PATHS.payloads.weaken)
        ) {
          totalWeaken += proc.threads;
        }
      }
    }

    // 3. Ziel-Server Statistiken abfragen
    let curSec = 0;
    let minSec = 0;
    let curMoney = 0;
    let maxMoney = 0;

    if (ns.serverExists(target)) {
      curSec = ns.getServerSecurityLevel(target);
      minSec = ns.getServerMinSecurityLevel(target);
      curMoney = ns.getServerMoneyAvailable(target);
      maxMoney = ns.getServerMaxMoney(target);
    }

    const uiData: EngineDashboardData = {
      engineName,
      target,
      status: progressStr || "Aktiv",
      ramUsed: Math.min(totalUsedRam, totalMaxRam),
      ramTotal: totalMaxRam,
      activeThreads: {
        hack: totalHack,
        grow: totalGrow,
        weaken: totalWeaken,
        total: totalHack + totalGrow + totalWeaken,
      },
      targetStats: {
        curSec,
        minSec,
        curMoney,
        maxMoney,
      },
      eventLog,
    };

    drawEngineDashboard(ns, uiData);
    await ns.sleep(500);
  }
}
