import { NS } from "@ns";
import { getAllServers } from "../lib/network.js";
import { patchState } from "./state-manager.js";
import { loadBnMults } from "../lib/state.js";
import { Logger } from "./logger.js";
import { JitEvent, BatchPlan } from "../core/types";
import { internalPlanner } from "../utils/internal-planner.js";
import {
  getNetworkMaxRam,
  getNetworkRealFreeRam,
  getQueueRam,
} from "../lib/ram-utils.js";
import {
  getAvailableWorkers,
  executeOnWorkers,
  pruneBatch,
} from "../lib/worker-executor.js";
import {
  PATH_GROW,
  PATH_HACK,
  PATH_WEAKEN,
  SPACER,
  BATCH_GAP,
} from "../lib/constants.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(
    ns,
    "JIT-Batcher",
    "INFO",
    "/logs/sys-jit-batcher.txt",
  );
  const bnMults = loadBnMults(ns);

  patchState(ns, { batcherActive: true, batcherProgress: "Initialisiere..." });

  // 1. Initialisierung aller Nodes im Netzwerk
  const initServers = getAllServers(ns);
  for (const s of initServers) {
    if (s !== "home" && ns.hasRootAccess(s)) {
      ns.killall(s, true);
      ns.scp([PATH_HACK, PATH_GROW, PATH_WEAKEN], s, "home");
    }
  }

  const eventQueue: JitEvent[] = [];
  const targetBlacklist = new Map<string, number>();

  let nextAvailableLandTime = 0;
  let batchIdCounter = 0;
  let prepEndTime = 0;
  let target: string | null = null;
  let dynamicMaxBatchesForTarget = 100;
  let batchesSentForTarget = 0;
  let lastStateUpdate = 0;
  let activePlan: BatchPlan | null = null;

  // 🛡️ LEVEL-GUARD: Speichert das aktuelle Hacking-Level zur Laufzeit-Überwachung
  let lastHackingLevel = ns.getHackingLevel();

  while (true) {
    const servers = getAllServers(ns);
    const now = Date.now();

    // ----------------------------------------------------------------------
    // 🛡️ 0. LEVEL-UP PRÜFUNG & QUEUE-FLUSH
    // ----------------------------------------------------------------------
    const currentLevel = ns.getHackingLevel();
    if (currentLevel !== lastHackingLevel) {
      logger.warn(
        `⬆️ Level-Up erkannt! (${lastHackingLevel} -> ${currentLevel}). Verwerfe desynchronisierte Queue...`,
      );
      lastHackingLevel = currentLevel;

      // 1. Noch nicht abgefeuerte Events löschen (ihre vorberechneten Startzeiten passen nicht mehr zu den neuen Skriptlaufzeiten)
      eventQueue.length = 0;

      // 2. Target & Plan zurücksetzen, damit der Planner sofort neu berechnet
      target = null;
      activePlan = null;
      batchesSentForTarget = 0;
      nextAvailableLandTime = 0;
      prepEndTime = 0;

      patchState(ns, {
        batcherProgress: `Level-Up auf ${currentLevel}! Neuberechnung...`,
        batcherTarget: "Re-Planning",
      });

      // Kurze Pause zum Durchatmen & Stabilisieren
      await ns.sleep(500);
      continue;
    }

    const isPrepping = now < prepEndTime;

    // Blacklist bereinigen
    for (const [key, expiry] of targetBlacklist.entries()) {
      if (now > expiry) targetBlacklist.delete(key);
    }

    // Warten auf Prep-Laufzeit
    if (eventQueue.length === 0 && isPrepping) {
      if (now - lastStateUpdate > 1000) {
        patchState(ns, {
          batcherProgress: `Warte auf Prep-Effekt (${Math.round((prepEndTime - now) / 1000)}s)`,
        });
        lastStateUpdate = now;
      }
      await ns.sleep(250);
      continue;
    }

    const realFreeRam = getNetworkRealFreeRam(ns, servers);
    const queueRam = getQueueRam(ns, eventQueue);
    const virtualFreeRam = realFreeRam - queueRam;

    // 🧠 PRÜFUNG: Wie viele aktive Batches laufen gerade für unser Ziel?
    const activeBatchesCount = new Set(
      eventQueue.filter((ev) => ev.target === target).map((ev) => ev.batchId),
    ).size;

    // Re-Planning NUR auslösen, wenn wir kein Ziel haben oder die Queue leer ist
    const needsNewPlan = !target || (eventQueue.length === 0 && !isPrepping);

    if (needsNewPlan && !isPrepping) {
      const planning = internalPlanner(
        ns,
        servers,
        getNetworkMaxRam(ns, servers),
        virtualFreeRam,
        bnMults,
        targetBlacklist,
        eventQueue.length,
        logger,
        target,
      );

      if (planning) {
        if (planning.target !== target) {
          // 🛡️ ZIEL-SCHUTZ: Erst wechseln, wenn die Queue des alten Targets leer ist!
          if (eventQueue.length > 0) {
            // Warten bis alte Events abgearbeitet sind
            await ns.sleep(250);
            continue;
          }
          nextAvailableLandTime = 0;
          logger.info(`🚀 JIT Wechsel auf Ziel: ${planning.target}`);
        }
        target = planning.target;
        activePlan = planning.plan;
        dynamicMaxBatchesForTarget = planning.maxBatches;
        batchesSentForTarget = 0;

        const mode = activePlan.hackThreads === 0 ? "PREP" : "HWGW";
        logger.info(
          `📋 JIT-Plan geladen: ${target} [${mode}] | RAM/Batch: ${activePlan.totalRam.toFixed(1)}GB | Max Batches: ${dynamicMaxBatchesForTarget}`,
        );
      }

      if (!target || !activePlan) {
        patchState(ns, {
          batcherProgress: "Suche optimales Target...",
          batcherTarget: "Suche...",
          batcherPlan: null,
        });
        await ns.sleep(1000);
        continue;
      }
    }

    // Event-Queue befüllen
    if (
      target &&
      activePlan &&
      activeBatchesCount < dynamicMaxBatchesForTarget
    ) {
      const isPrepBatch = activePlan.hackThreads === 0;
      const safeVirtualRam = isPrepBatch
        ? virtualFreeRam * 0.95
        : virtualFreeRam * 0.8;

      if (safeVirtualRam >= activePlan.totalRam) {
        if (nextAvailableLandTime < now + activePlan.weakenTime + 500) {
          nextAvailableLandTime = now + activePlan.weakenTime + 500;
        }

        const bId = batchIdCounter++;
        const tLand = nextAvailableLandTime;

        const validEvents: JitEvent[] = [
          {
            id: `b${bId}-h`,
            batchId: bId,
            script: PATH_HACK,
            threads: activePlan.hackThreads,
            target,
            startTime: tLand - SPACER - activePlan.hackTime,
            landTime: tLand - SPACER,
          },
          {
            id: `b${bId}-w1`,
            batchId: bId,
            script: PATH_WEAKEN,
            threads: activePlan.weaken1Threads,
            target,
            startTime: tLand - activePlan.weakenTime,
            landTime: tLand,
          },
          {
            id: `b${bId}-g`,
            batchId: bId,
            script: PATH_GROW,
            threads: activePlan.growThreads,
            target,
            startTime: tLand + SPACER - activePlan.growTime,
            landTime: tLand + SPACER,
          },
          {
            id: `b${bId}-w2`,
            batchId: bId,
            script: PATH_WEAKEN,
            threads: activePlan.weaken2Threads,
            target,
            startTime: tLand + 2 * SPACER - activePlan.weakenTime,
            landTime: tLand + 2 * SPACER,
          },
        ].filter((ev) => ev.threads > 0);

        eventQueue.push(...validEvents);
        eventQueue.sort((a, b) => a.startTime - b.startTime);

        batchesSentForTarget++;

        // 🎯 SAUBERES PIPELINING:
        // 4 * SPACER verhindert, dass Hack von Batch N+1 in Weaken1 von Batch N krachte!
        nextAvailableLandTime += Math.max(BATCH_GAP, SPACER * 4);

        if (activePlan.hackThreads === 0) {
          prepEndTime = now + activePlan.weakenTime + 1000;
        }

        patchState(ns, {
          batcherTarget: target,
          batcherProgress: `JIT-HWGW Active (${activeBatchesCount + 1}/${dynamicMaxBatchesForTarget} Batches)`,
          batcherPlan: activePlan,
        });
      } else if (eventQueue.length === 0) {
        logger.warn(
          `⚠️ RAM erschöpft für ${target} (Frei: ${virtualFreeRam.toFixed(1)}GB). Target-Reset.`,
        );
        target = null;
        activePlan = null;
        prepEndTime = 0;
        nextAvailableLandTime = 0;
        await ns.sleep(3000);
        continue;
      }
    }

    // JIT Dispatch Loop (Just-in-Time Abfeuern)
    while (eventQueue.length > 0 && Date.now() >= eventQueue[0].startTime) {
      const event = eventQueue.shift()!;
      const lag = Date.now() - event.startTime;

      if (lag > 60) {
        logger.warn(
          `⏳ Lag (${Math.round(lag)}ms) bei Event ${event.id}. Batch verworfen.`,
        );
        pruneBatch(eventQueue, event.batchId);
        continue;
      }

      const workers = getAvailableWorkers(ns, servers);
      const dispatched = executeOnWorkers(ns, event, workers);

      if (!dispatched) {
        logger.error(
          `🛑 RAM-Engpass bei ${event.target} (Event: ${event.id}). Leite Recovery ein...`,
        );
        ns.toast(`RAM-Engpass bei ${event.target}!`, "warning", 3000);

        targetBlacklist.set(event.target, now + 45000);

        // Events des fehlgeschlagenen Targets aus Queue entfernen
        const filteredQueue = eventQueue.filter(
          (ev) => ev.target !== event.target,
        );
        eventQueue.length = 0;
        eventQueue.push(...filteredQueue);

        if (target === event.target) {
          target = null;
          activePlan = null;
          batchesSentForTarget = 0;
          prepEndTime = 0;
          nextAvailableLandTime = 0;
        }

        patchState(ns, {
          batcherProgress: "RAM-Coolingdown... Warte auf Freigabe",
          batcherTarget: "Standby",
        });
        await ns.sleep(3000);
        break;
      }
    }

    // Precision Sleep Management
    if (eventQueue.length > 0) {
      const timeToNext = eventQueue[0].startTime - Date.now();
      await ns.sleep(Math.max(1, timeToNext));
    } else {
      await ns.sleep(50);
    }
  }
}
