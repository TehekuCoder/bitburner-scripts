import { NS } from "@ns";
import { getAllServers } from "../network/network";
import { HOME_RAM_RESERVE } from "../runtime/batcher";
import { loadBatcherState } from "../state/state";
import { DashboardData } from "/shared/types/batcher";
import { drawBatcherDashboard } from "/ui/batcher-ui";



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
  ns.ui.setTailTitle("JIT-Batcher Monitor");
  ns.ui.resizeTail(620, 540);

  const eventLog: string[] = [];
  let lastTarget = "";
  let lastPhase = "";

  ns.print("Warte auf Synchronisation mit Kernel-Port 1...");

  while (true) {
    const state = loadBatcherState(ns);

    if (!state || !state.batcherActive) {
      ns.clearLog();
      ns.print("============================================================");
      ns.print("🛰️ BIT-OS JIT-BATCHER UI MONITOR");
      ns.print("============================================================");
      ns.print("STATUS: Warten auf Aktivierung von JIT-Batcher");
      ns.print("============================================================");
      await ns.sleep(1000);
      continue;
    }

    const rawTarget = state.batcherTarget ?? "Keines";
    const primaryTarget = getPrimaryTarget(rawTarget);
    const progressStr = state.batcherProgress ?? "";
    const targetsSummary = state.batcherTargetsSummary ?? [];

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

    if (state.batcherPhase && state.batcherPhase !== lastPhase) {
      eventLog.push(
        `[${new Date().toLocaleTimeString()}] ⚙️ Modus: ${state.batcherPhase}`,
      );
      lastPhase = state.batcherPhase;
    }

    if (eventLog.length > 3) eventLog.shift();

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

    let totalActiveBatches = 0;
    let totalMaxBatches = 0;
    let averageGreed = 0;
    let totalRamNeeded = state.batcherRamNeeded ?? 0;

    if (targetsSummary.length > 0) {
      for (const t of targetsSummary) {
        totalActiveBatches += t.activeBatches;
        totalMaxBatches += t.maxBatches;
        averageGreed += t.greed;
        if (t.batchRam) totalRamNeeded += t.batchRam;
      }
      averageGreed /= targetsSummary.length;
    } else {
      totalMaxBatches = state.batcherDynamicMaxBatches ?? 100;
      averageGreed =
        state.batcherPlan?.greed ?? state.batcherPlan?.greedFactor ?? 0;
    }

    const totalProgressPercent =
      totalMaxBatches > 0 ? totalActiveBatches / totalMaxBatches : 0;

    let totalWaveProfit = 0;
    if (ns.formulas && ns.formulas.hacking) {
      for (const t of targetsSummary) {
        if (t.mode === "HWGW" && ns.serverExists(t.target)) {
          const serverObj = ns.getServer(t.target);
          totalWaveProfit += (serverObj.moneyMax ?? 0) * t.greed;
        }
      }
    }

    const displayTarget =
      targetsSummary.length > 1
        ? `${primaryTarget} (+${targetsSummary.length - 1})`
        : primaryTarget;

    const uiData: DashboardData = {
      status: `Multi-Target (${targetsSummary.length} aktiv)`,
      target: displayTarget,
      progress: Math.min(1.0, Math.max(0, totalProgressPercent)),
      progressText: `${totalActiveBatches} Batches (${targetsSummary.length} Ziele)`,
      greed: averageGreed,
      ramNeeded: totalRamNeeded,
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
