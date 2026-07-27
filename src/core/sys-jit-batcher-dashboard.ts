import { NS } from "@ns";
import { drawBatcherDashboard } from "ui/batcher-ui.js";
import { HOME_RAM_RESERVE } from "/lib/constants.js";
import { getAllServers } from "/lib/network.js";
import { loadState } from "/lib/state.js";
import { DashboardData } from "/lib/types.js";

/** Hilfsfunktion: Entfernt Countdown-Klammern für den Event-Log-Vergleich */
function cleanProgressString(str: string): string {
  return str.replace(/\s*\([^)]*?\d+s[^)]*?\)/g, "").trim();
}

/** Hilfsfunktion: Liefert den ersten validen Servernamen aus einer kommasparierten Liste */
function getPrimaryTarget(rawTarget: string): string {
  if (!rawTarget) return "Keines";
  if (rawTarget.includes(",")) {
    return rawTarget.split(",")[0].trim();
  }
  return rawTarget.trim();
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.ui.resizeTail(579, 492);

  const eventLog: string[] = [];
  let lastTarget = "";
  let lastStateString = "";

  ns.print("Warte auf Synchronisation mit Kernel-Port 1...");

  while (true) {
    const state = loadState(ns);

    // Failsafe, falls der JIT-Batcher inaktiv ist
    if (!state || !state.batcherActive) {
      ns.clearLog();
      ns.print("============================================================");
      ns.print("🛰️ BIT-OS JIT-BATCHER UI MONITOR");
      ns.print("============================================================");
      ns.print("STATUS: Warten auf Aktivierung von core/sys-jit-batcher.js...");
      ns.print("============================================================");
      await ns.sleep(1000);
      continue;
    }

    const rawTarget = state.batcherTarget ?? "Keines";
    const primaryTarget = getPrimaryTarget(rawTarget);
    const progressStr = state.batcherProgress ?? "";
    const targetsSummary = state.batcherTargetsSummary ?? [];

    // 1. Dynamic Event-Logging für Zustandsänderungen
    if (
      rawTarget !== lastTarget &&
      rawTarget !== "Suche..." &&
      rawTarget !== "Keines" &&
      rawTarget !== "Standby"
    ) {
      if (lastTarget && lastTarget !== "Keines" && lastTarget !== "Suche...") {
        eventLog.push(
          `[${new Date().toLocaleTimeString()}] 🎯 targets: ${lastTarget} ➡️ ${rawTarget}`,
        );
      } else {
        eventLog.push(
          `[${new Date().toLocaleTimeString()}] 🚀 JIT Multi-Zündung: ${rawTarget}`,
        );
      }
      lastTarget = rawTarget;
    }

    const cleanCurrent = cleanProgressString(progressStr);
    const cleanLast = cleanProgressString(lastStateString);

    if (cleanCurrent !== cleanLast && !progressStr.includes("Executing")) {
      eventLog.push(`[${new Date().toLocaleTimeString()}] ⚙️ ${progressStr}`);
      lastStateString = progressStr;
    } else {
      lastStateString = progressStr;
    }

    if (eventLog.length > 4) eventLog.shift();

    // 2. Live RAM-Metriken berechnen
    let totalMaxRam = 0;
    let totalUsedRam = 0;
    const servers = getAllServers(ns);

    for (const s of servers) {
      if (!ns.hasRootAccess(s)) continue;
      let max = ns.getServerMaxRam(s);
      if (s === "home") max = Math.max(0, max - HOME_RAM_RESERVE);
      totalMaxRam += max;
      totalUsedRam += ns.getServerUsedRam(s);
    }
    const ramFree = Math.max(0, totalMaxRam - totalUsedRam);

    // 3. Multi-Target Metriken aufsummieren
    let totalActiveBatches = 0;
    let totalMaxBatches = 0;
    let totalProgressPercent = 0;
    let averageGreed = 0;

    if (targetsSummary.length > 0) {
      for (const t of targetsSummary) {
        totalActiveBatches += t.activeBatches;
        totalMaxBatches += t.maxBatches;
        averageGreed += t.greed;
      }
      averageGreed /= targetsSummary.length;
      totalProgressPercent =
        totalMaxBatches > 0 ? totalActiveBatches / totalMaxBatches : 0;
    } else {
      totalMaxBatches = state.batcherDynamicMaxBatches ?? 100;
      averageGreed =
        state.batcherPlan?.greed ?? state.batcherPlan?.greedFactor ?? 0;
    }

    // 4. Gewinn-Schätzung pro Welle via Formulas-API (über alle HWGW-Ziele)
    let totalWaveProfit = 0;
    if (ns.formulas && ns.formulas.hacking) {
      const playerObj = ns.getPlayer();

      for (const t of targetsSummary) {
        if (t.mode === "HWGW" && ns.serverExists(t.target)) {
          const serverObj = ns.getServer(t.target);

          // Schätzung basierend auf dem Greed-Faktor des Ziels
          totalWaveProfit += (serverObj.moneyMax ?? 0) * t.greed;
        }
      }
    }

    // 5. UI-Daten-Objekt füttern
    // Falls ein Einzel-Target übergeben wird, nutzen wir primaryTarget, sonst zeigen wir die Zusammenfassung
    const displayTarget =
      targetsSummary.length > 1
        ? `${primaryTarget} (+${targetsSummary.length - 1})`
        : primaryTarget;

    const uiData: DashboardData = {
      status: `Multi-Target (${targetsSummary.length} aktiv)`,
      target: displayTarget,
      progress: Math.min(1.0, Math.max(0, totalProgressPercent)),
      progressText: `${totalActiveBatches} / ${totalMaxBatches} Batches`,
      greed: averageGreed,
      ramNeeded: state.batcherRamNeeded ?? 0,
      ramFree: ramFree,
      ramTotal: totalMaxRam,
      batchesSent: totalActiveBatches,
      batchesMax: totalMaxBatches,
      eventLog: eventLog,
      lastWaveProfit: totalWaveProfit,
      targetsSummary: targetsSummary,
    };

    drawBatcherDashboard(ns, uiData);

    await ns.sleep(500);
  }
}