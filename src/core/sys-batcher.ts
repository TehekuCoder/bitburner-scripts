import { NS } from "@ns";
import { getAllServers } from "../lib/network.js";
import { patchState, loadState } from "./state-manager.js";
import { loadBnMults } from "../lib/state.js";
import { Logger } from "./logger.js";
import { InFlightBatch, WorkerNode } from "core/types";
import { drawBatcherDashboard } from "core/batcher-ui.js";

// Wir importieren NUR das Interface für Typsicherheit (kostet 0.00 GB RAM zur Laufzeit!)
import { BatchPlan } from "../utils/batch-calculator.js";
import { dispatchSplitBatch } from "core/batch-dispatcher";

let cachedServers: string[] = [];
let lastCacheUpdate = 0;
let lastUiUpdate = 0;
const eventLog: string[] = [];

const HOME_RAM_RESERVE = 64;
const SCRIPT_RAM_BASE = 1.75;
const SPACER = 80;

function updateServerCache(ns: NS): void {
  const now = Date.now();
  if (now - lastCacheUpdate > 2000 || cachedServers.length === 0) {
    cachedServers = getAllServers(ns).sort(
      (a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a),
    );
    lastCacheUpdate = now;
  }
}

function logEvent(msg: string): void {
  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  eventLog.push(`[${time}] ${msg}`);
  if (eventLog.length > 4) eventLog.shift();
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const logger = new Logger(ns, "Batcher", "INFO");
  const bnMults = loadBnMults(ns);

  // 🟢 INITIALISIERUNG: Dem State-Manager sofort mitteilen, dass wir hochfahren
  patchState(ns, { batcherProgress: "Initialisiere..." });

  if (
    (bnMults.ScriptHackMoneyGain ?? 1) === 0 ||
    (bnMults.ServerMaxMoney ?? 1) === 0
  ) {
    logger.error(
      "Hacking-Multiplikatoren blockieren Profit-Generierung. Batcher terminiert.",
    );
    logEvent("🛑 Hacking wirft hier kein Geld ab. Batcher deaktiviert.");
    patchState(ns, { batcherProgress: "Inaktiv (Kein Profit)" });
    return;
  }

  let batchId = 0;
  let target: string | null = null;
  let batchesSentForTarget = 0;
  let dynamicMaxBatchesForTarget = 500;

  let lastLogStatus = "";
  let stallSettleTicks = 0;
  let lockedPlan: BatchPlan | null = null;
  let lastWaveProfit = 0;

  logger.info("System initialisiert. Synchronisiere Netzwerk-Pool...");
  logEvent("System initialisiert. Warte auf Netzwerk-Pool...");

  while (true) {
    updateServerCache(ns);

    let totalUsableMaxRam = 0;
    let totalUsableFreeRam = 0;

    const currentState = loadState(ns);
    const shareBufferPercent =
      currentState?.fillerConfig?.shareMaxRamPercent || 0.0;

    // 🟢 NEU: Vorbereitung der strukturierten Worker-Knoten für den Dispatcher
    const workers: WorkerNode[] = [];

    for (const server of cachedServers) {
      if (!ns.hasRootAccess(server)) continue;
      let maxRam = ns.getServerMaxRam(server);
      if (server === "home") maxRam = Math.max(0, maxRam - HOME_RAM_RESERVE);

      if (server !== "home" && shareBufferPercent > 0) {
        maxRam = maxRam * (1 - shareBufferPercent);
      }

      const usedRam = ns.getServerUsedRam(server);
      const freeRam = Math.max(0, maxRam - usedRam);

      totalUsableMaxRam +=
        Math.floor(maxRam / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;
      totalUsableFreeRam +=
        Math.floor(freeRam / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;

      // Wir nehmen nur Server in den Pool auf, auf denen tatsächlich gearbeitet werden kann
      if (freeRam > 0) {
        workers.push({
          hostname: server,
          maxRam: maxRam,
          freeRam: freeRam,
        });
      }
    }

    // Sortiere Worker absteigend nach freiem RAM (Größte zuerst = weniger Thread-Fragmentierung!)
    workers.sort((a, b) => b.freeRam - a.freeRam);

    // 🎯 TARGETING & REPLANNING (Mit verbesserter Fehlerdiagnose!)
    if (!target || batchesSentForTarget >= dynamicMaxBatchesForTarget) {
      logger.info("Starte Batch-Planer für Zielfindung...");
      logEvent("📡 Suche optimales Ziel...");
      patchState(ns, { batcherProgress: "Suche Ziel..." });

      const pid = ns.exec("utils/batch-planner.js", "home", 1);

      // 🔴 DIAGNOSE A: Start-Fehlschlag prüfen
      if (pid === 0) {
        logger.error(
          "🛑 Konnte 'utils/batch-planner.js' nicht starten! RAM-Mangel oder Datei existiert nicht.",
        );
        logEvent("🛑 Planner-Start fehlgeschlagen!");
        patchState(ns, { batcherProgress: "Fehler: Start Planner" });
        await ns.sleep(5000);
        continue;
      }

      // Warten auf Beendigung des Planners
      while (ns.isRunning(pid)) {
        await ns.sleep(50);
      }

      const newState = loadState(ns);
      target = newState?.batcherTarget || null;
      lockedPlan = newState?.batcherPlan || null;
      dynamicMaxBatchesForTarget = newState?.batcherDynamicMaxBatches || 500;
      batchesSentForTarget = 0;

      if (target && lockedPlan) {
        logger.success(
          `Pipeline-Plan fixiert: ${target} (Ram: ${ns.format.ram(lockedPlan.totalRam)})`,
        );
        logEvent(`🔒 Pipeline-Plan geladen: ${target}`);
      } else {
        logger.warn(`Kein valides Ziel gefunden. Rotiere Zielfindung...`);

        // 🔴 DIAGNOSE B: Fehlt Formulas.exe?
        if (!ns.formulas || !ns.formulas.hacking) {
          logger.error(
            "🚨 SYSTEM-FEHLER: 'Formulas.exe' ist nicht freigeschaltet! Batch-Berechnung unmöglich.",
          );
          logEvent("🚨 Fehler: Formulas fehlt!");
          patchState(ns, { batcherProgress: "Formulas.exe fehlt!" });
        } else {
          // 🔴 DIAGNOSE C: Stiller Absturz des Planners
          logger.error(
            "⚠️ Planner beendet, aber kein Ziel im State hinterlassen. Eventuell Absturz im Planner-Skript?",
          );
          logEvent("⚠️ Planner-Fehler!");
          patchState(ns, { batcherProgress: "Planner lieferte kein Ziel" });
        }

        target = null;
        lockedPlan = null;
        await ns.sleep(5000);
        continue;
      }
    }

    const minSec = ns.getServerMinSecurityLevel(target);
    const curSec = ns.getServerSecurityLevel(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const curMoney = ns.getServerMoneyAvailable(target);

    // --- PIPELINE-AWARE DESYNC CHECK ---
    let isMassiveDesync = false;

    isMassiveDesync = curSec > minSec + 3.0; // Das hier reicht völlig aus!

    const needsInitialPrep =
      batchesSentForTarget === 0 && (curSec > minSec || curMoney < maxMoney);

    // --- KALIBRIERUNGS- & DESYNC-MANAGEMENT ---
    if (needsInitialPrep || isMassiveDesync) {
      const currentWeakenTime = ns.getWeakenTime(target);
      lockedPlan = null;

      if (batchesSentForTarget === 0) {
        logger.info(`Initialisiere Prep-Phase für Zielserver: ${target}`);
        logEvent(`🔧 Kalibrierte Prep-Welle abgefeuert.`);
        executePrepPhase(ns, cachedServers, target, bnMults);
      } else {
        logger.warn(
          `🚨 Pipeline Desync auf ${target} erkannt! Flushe Pipeline...`,
        );
        logEvent(`🛑 Desync! Pipeline geflusht & Recovery eingeleitet.`);
        await ns.sleep(SPACER * 10);
        executePrepPhase(ns, cachedServers, target, bnMults);
      }

      const prepDuration = currentWeakenTime + SPACER * 2;
      const prepStartedAt = Date.now();

      while (Date.now() - prepStartedAt < prepDuration) {
        const elapsed = Date.now() - prepStartedAt;
        const progress = Math.min(1, elapsed / prepDuration);
        const secsLeft = Math.max(0, (prepDuration - elapsed) / 1000);

        let tRam = 0;
        let tFree = 0;
        for (const s of cachedServers) {
          if (!ns.hasRootAccess(s)) continue;
          let mRam = ns.getServerMaxRam(s);
          if (s === "home") mRam = Math.max(0, mRam - HOME_RAM_RESERVE);
          if (currentState?.strategy === "REP" && s !== "home") {
            mRam = mRam * (1 - shareBufferPercent);
          }
          const uRam = ns.getServerUsedRam(s);
          tRam += Math.floor(mRam / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;
          tFree +=
            Math.floor((mRam - uRam) / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;
        }

        drawBatcherDashboard(ns, {
          status: "PREPPING",
          target,
          progress,
          progressText: `${secsLeft.toFixed(1)}s verbleibend`,
          greed: 0.0,
          ramNeeded: 0,
          ramFree: tFree,
          ramTotal: tRam,
          batchesSent: 0,
          batchesMax: dynamicMaxBatchesForTarget,
          eventLog,
          lastWaveProfit,
        });

        await ns.sleep(250);
      }

      batchesSentForTarget = 0;
      continue;
    }

    if (!lockedPlan) {
      target = null;
      continue;
    }

    // 📈 LEVEL-UP REKALIBRIERUNG
    const trueWeakenTime = ns.getWeakenTime(target);
    const planWeakenTime = lockedPlan.executionTime - SPACER * 2;

    if (trueWeakenTime < planWeakenTime) {
      const timeDelta = planWeakenTime - trueWeakenTime;
      logger.info(
        `📈 Level-Up registriert! Laufzeitverkürzung um ${(timeDelta / 1000).toFixed(2)}s. Rufe Planer...`,
      );
      logEvent(`📈 Level-Up erkannt! Rekalibriere...`);

      const pid = ns.exec("utils/batch-planner.js", "home", 1);
      if (pid > 0) {
        while (ns.isRunning(pid)) {
          await ns.sleep(50);
        }
      }
      const newState = loadState(ns);
      lockedPlan = newState?.batcherPlan || null;

      const startSleep = Date.now();
      while (Date.now() - startSleep < timeDelta) {
        if (Date.now() - lastUiUpdate > 250) {
          drawBatcherDashboard(ns, {
            status: "RECALIBRATING",
            target,
            progress: (Date.now() - startSleep) / timeDelta,
            progressText: `Warte auf Überholpuffer... (${((timeDelta - (Date.now() - startSleep)) / 1000).toFixed(1)}s)`,
            greed: lockedPlan ? lockedPlan.hackThreads * 0.02 : 0,
            ramNeeded: lockedPlan ? lockedPlan.totalRam : 0,
            ramFree: totalUsableFreeRam,
            ramTotal: totalUsableMaxRam,
            batchesSent: batchesSentForTarget,
            batchesMax: dynamicMaxBatchesForTarget,
            eventLog,
            lastWaveProfit,
          });
          lastUiUpdate = Date.now();
        }
        await ns.sleep(100);
      }
    }

    const plan = lockedPlan;
    if (!plan) {
      target = null;
      continue;
    }

    const profitGreed = plan.hackThreads * 0.04;
    lastWaveProfit = maxMoney * profitGreed;

    // --- RAM RESOURCE LOCK CHECKS ---
    if (totalUsableFreeRam < plan.totalRam) {
      const requiredRam = plan.totalRam;

      if (Date.now() - lastUiUpdate > 250) {
        drawBatcherDashboard(ns, {
          status: "STALLED (RAM)",
          target,
          progress: totalUsableFreeRam / Math.max(1, requiredRam),
          progressText: `${ns.format.ram(totalUsableFreeRam)} / ${ns.format.ram(requiredRam)}`,
          greed: plan.hackThreads * 0.02,
          ramNeeded: requiredRam,
          ramFree: totalUsableFreeRam,
          ramTotal: totalUsableMaxRam,
          batchesSent: batchesSentForTarget,
          batchesMax: dynamicMaxBatchesForTarget,
          eventLog,
          lastWaveProfit,
        });
        lastUiUpdate = Date.now();
      }

      await ns.sleep(SPACER * 4);
      continue;
    }

    // 🟢 ERSETZEN DURCH:
    // Wir feuern bedingungslos, solange kein massiver Desync (Security > minSec + 3.0) vorliegt!
    const dispatchSuccess = dispatchSplitBatch(ns, plan, workers, batchId);

    if (!dispatchSuccess) {
      if (Date.now() - lastUiUpdate > 250) {
        drawBatcherDashboard(ns, {
          status: "STALLED (FRAG)",
          target,
          progress: totalUsableFreeRam / plan.totalRam,
          progressText: `RAM fragmentiert`,
          greed: plan.hackThreads * 0.02,
          ramNeeded: plan.totalRam,
          ramFree: totalUsableFreeRam,
          ramTotal: totalUsableMaxRam,
          batchesSent: batchesSentForTarget,
          batchesMax: dynamicMaxBatchesForTarget,
          eventLog,
          lastWaveProfit,
        });
        lastUiUpdate = Date.now();
      }
      await ns.sleep(SPACER);
      continue;
    }

    batchId++;
    batchesSentForTarget++;

    if (Date.now() - lastUiUpdate > 250) {
      drawBatcherDashboard(ns, {
        status: "RUNNING",
        target,
        progress: batchesSentForTarget / dynamicMaxBatchesForTarget,
        progressText: `Welle #${batchId} (${batchesSentForTarget}/${dynamicMaxBatchesForTarget})`,
        greed: plan.hackThreads * 0.02,
        ramNeeded: plan.totalRam,
        ramFree: totalUsableFreeRam,
        ramTotal: totalUsableMaxRam,
        batchesSent: batchesSentForTarget,
        batchesMax: dynamicMaxBatchesForTarget,
        eventLog,
        lastWaveProfit,
      });
      lastUiUpdate = Date.now();
    }

    await ns.sleep(SPACER);
  }
}

function makeProgressBar(progress: number, width = 20): string {
  const filledLength = Math.round(Math.max(0, Math.min(1, progress)) * width);
  const emptyLength = width - filledLength;
  return "█".repeat(filledLength) + "░".repeat(emptyLength);
}

function dispatchBatchScript(
  ns: NS,
  allServers: string[],
  script: string,
  threads: number,
  target: string,
  delay: number,
  id: number,
): void {
  const currentState = loadState(ns);
  const shareBufferPercent =
    currentState?.fillerConfig?.shareMaxRamPercent || 0.0;

  if (threads <= 0) return;
  const scriptRam = ns.getScriptRam(script);
  if (scriptRam === 0) return;
  let threadsRemaining = threads;

  for (const server of allServers) {
    if (!ns.hasRootAccess(server)) continue;
    let maxRam = ns.getServerMaxRam(server);
    if (server === "home") {
      maxRam = Math.max(0, maxRam - HOME_RAM_RESERVE);
    } else if (currentState?.strategy === "REP") {
      maxRam = maxRam * (1 - shareBufferPercent);
    }

    const freeRam = maxRam - ns.getServerUsedRam(server);
    const possibleThreads = Math.floor(freeRam / scriptRam);

    if (possibleThreads > 0) {
      const threadsToRun = Math.min(possibleThreads, threadsRemaining);

      if (server !== "home" && !ns.fileExists(script, server)) {
        ns.scp(script, server, "home");
      }

      ns.exec(script, server, threadsToRun, target, delay, id);
      threadsRemaining -= threadsToRun;
      if (threadsRemaining <= 0) break;
    }
  }
}

function executePrepPhase(ns: NS, allServers: string[], target: string, bnMults: any): void {
  const minSec = ns.getServerMinSecurityLevel(target);
  const curSec = ns.getServerSecurityLevel(target);
  const maxMoney = ns.getServerMaxMoney(target);
  const curMoney = ns.getServerMoneyAvailable(target);
  const weakenPotency = 0.05 * (bnMults.ServerWeakenRate ?? 1.0);

  // 1. Wenn Security zu hoch ist, schwächen
  if (curSec > minSec) {
    const secDeficit = curSec - minSec;
    const weakenThreads = Math.ceil(secDeficit / weakenPotency);
    dispatchBatchScript(ns, allServers, "tasks/weaken.js", weakenThreads, target, 0, Date.now());
  } 
  
  // 2. Unabhängig davon: Wenn Geld fehlt, zeitgleich Grow + Kompensations-Weaken feuern!
  if (curMoney < maxMoney) {
    const growthMultiplier = maxMoney / Math.max(1, curMoney);
    const growThreads = Math.ceil(ns.growthAnalyze(target, growthMultiplier));
    const weakenThreadsNeeded = Math.ceil((growThreads * 0.004) / weakenPotency);

    dispatchBatchScript(ns, allServers, "tasks/grow.js", growThreads, target, 0, Date.now());
    dispatchBatchScript(ns, allServers, "tasks/weaken.js", weakenThreadsNeeded, target, 50, Date.now());
  }
}