import { NS } from "@ns";
import { loadState } from "./state-manager.js";
import { drawBatcherDashboard } from "./batcher-ui.js";
import { getAllServers } from "../lib/network.js";
import { DashboardData } from "./types.js";

const HOME_RAM_RESERVE = 64;

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

    const currentTarget = state.batcherTarget ?? "Keines";
    const progressStr = state.batcherProgress ?? "";

    // 1. Dynamic Event-Logging für Zustandsänderungen
    if (
      currentTarget !== lastTarget &&
      currentTarget !== "Suche..." &&
      currentTarget !== "Keines" &&
      currentTarget !== "Standby"
    ) {
      if (lastTarget && lastTarget !== "Keines" && lastTarget !== "Suche...") {
        eventLog.push(
          `[${new Date().toLocaleTimeString()}] 🎯 Target: ${lastTarget} ➡️ ${currentTarget}`,
        );
      } else {
        eventLog.push(
          `[${new Date().toLocaleTimeString()}] 🚀 JIT-Zündung auf Ziel: ${currentTarget}`,
        );
      }
      lastTarget = currentTarget;
    }

    if (progressStr !== lastStateString && !progressStr.includes("Executing")) {
      eventLog.push(`[${new Date().toLocaleTimeString()}] ⚙️ ${progressStr}`);
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

    // 3. Werte intelligent aus dem JIT-State parsen
    let progressPercent = 0;
    let batchesSent = 0;
    let statusText = progressStr;
    let subText = "";

    // Zerlege den JIT-Status für die UI-Segmente
    if (progressStr.includes("|")) {
      const parts = progressStr.split("|");
      statusText = parts[0].trim();
      subText = parts[1].trim();
    } else if (progressStr.includes("(")) {
      const parts = progressStr.split("(");
      statusText = parts[0].trim();
      subText = "(" + parts[1];
    }

    // Extrahiere gesendete Batches aus dem String "Pipelines gefüllt (12/100)"
    const match = progressStr.match(/\((\d+)\/(\d+)\)/);
    if (match) {
      batchesSent = parseInt(match[1], 10);
      progressPercent = batchesSent / parseInt(match[2], 10);
    } else if (progressStr.includes("Executing")) {
      progressPercent = 1.0;
      // Versuche die aktuelle Queue-Größe als gesendete Wellen zu mappen
      const qMatch = progressStr.match(/Queue:\s*(\d+)/);
      if (qMatch) batchesSent = Math.floor(parseInt(qMatch[1], 10) / 4);
    }

    // 4. Gewinn-Schätzung pro Welle via Formulas-API
    let waveProfit = 0;
    if (
      state.batcherPlan &&
      servers.includes(currentTarget) // 🟢 FIX: Verhindert Abstürze durch Status-Strings wie "Standby"
    ) {
      const plan = state.batcherPlan;
      if (ns.formulas && ns.formulas.hacking) {
        const serverObj = ns.getServer(currentTarget);
        const playerObj = ns.getPlayer();
        const pctPerThread = ns.formulas.hacking.hackPercent(
          serverObj,
          playerObj,
        );
        waveProfit =
          (serverObj.moneyMax ?? 0) * (plan.hackThreads * pctPerThread);
      }
    }

    // 5. UI-Daten-Objekt füttern (Mit Serverschutz-Validierung)
    const uiData: DashboardData = {
      status: statusText,
      // 🟢 FIX: Nur wenn das Target ein echter Server oder eine bekannte UI-Ausnahme ist, durchlassen
      target:
        servers.includes(currentTarget) ||
        currentTarget === "Suche..." ||
        currentTarget === "Keines"
          ? currentTarget
          : "Suche...",
      progress: progressPercent,
      progressText: subText || statusText,
      greed: state.batcherPlan?.greedFactor ?? state.batcherPlan?.greed ?? 0.0,
      ramNeeded: state.batcherRamNeeded ?? 0,
      ramFree: ramFree,
      ramTotal: totalMaxRam,
      batchesSent: batchesSent,
      batchesMax: state.batcherDynamicMaxBatches ?? 100,
      eventLog: eventLog,
      lastWaveProfit: waveProfit,
    };

    drawBatcherDashboard(ns, uiData);

    // 🛑 Auf 500ms erhöht, um dem JIT-Batcher Luft zum Atmen zu geben (weniger Engine-Lags!)
    await ns.sleep(500);
  }
}
