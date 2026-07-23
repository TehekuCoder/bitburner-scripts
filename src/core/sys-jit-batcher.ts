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
  let servers = getAllServers(ns);
  let lastServerScan = Date.now();

  for (const s of servers) {
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
  let activePlan: BatchPlan | null = null;

  // Tracke aktive Batch-IDs direkt als Set, um teures .filter() in der Schleife zu vermeiden
  const activeBatchIds = new Set<number>();

  let lastHackingLevel = ns.getHackingLevel();
  const batchEventCounts = new Map<number, number>();

  while (true) {
    const now = Date.now();

    // 🚀 CACHING: Server-Netzwerk nur alle 10 Sekunden neu scannen
    if (now - lastServerScan > 10000) {
      servers = getAllServers(ns);
      lastServerScan = now;
    }

    const isPrepping = now < prepEndTime;

    // ----------------------------------------------------------------------
    // 🛡️ 0. LEVEL-UP PRÜFUNG & QUEUE-FLUSH
    // ----------------------------------------------------------------------
    const currentLevel = ns.getHackingLevel();
    const levelDelta = currentLevel - lastHackingLevel;

    if (
      levelDelta >= 5 ||
      (lastHackingLevel > 0 && levelDelta / lastHackingLevel > 0.02)
    ) {
      logger.warn(
        `⬆️ Signifikanter Level-Up! (${lastHackingLevel} -> ${currentLevel}). Flushe Queue & Planer-Reset...`,
      );
      lastHackingLevel = currentLevel;

      // FIX: Vollständiger Reset bei Level-Up
      target = null;
      activePlan = null;
      eventQueue.length = 0;
      activeBatchIds.clear();
      batchEventCounts.clear();
      nextAvailableLandTime = 0;
    } else if (levelDelta > 0) {
      lastHackingLevel = currentLevel;
    }

    const activeBatchesCount = activeBatchIds.size;
    // ----------------------------------------------------------------------
    // 🩺 1. KONTINUIERLICHER HEALTH-CHECK
    // ----------------------------------------------------------------------
    if (target && !isPrepping) {
      const currentSec = ns.getServerSecurityLevel(target);
      const minSec = ns.getServerMinSecurityLevel(target);
      const currentMoney = ns.getServerMoneyAvailable(target);
      const maxMoney = ns.getServerMaxMoney(target);

      const secDesync = currentSec > minSec + 1.0;
      const moneyDesync =
        activeBatchesCount === 0 && currentMoney < maxMoney * 0.9;

      if (secDesync || moneyDesync) {
        // 👈 secDesync & moneyDesync nutzen
        logger.warn(
          `⚠️ Target ${target} desynchronisiert! (Sec: ${currentSec.toFixed(1)}/${minSec}, $:${(currentMoney / 1e6).toFixed(1)}M/${(maxMoney / 1e6).toFixed(1)}M). Abbruch & Re-Prep...`,
        );

        // 💥 FIX: Sperren NUR im Fehlerfall aufrufen!
        targetBlacklist.set(target, now + 30000);

        target = null;
        activePlan = null;
        eventQueue.length = 0;
        activeBatchIds.clear();
        batchEventCounts.clear();
        nextAvailableLandTime = 0;
      }
    }

    // Abgelaufene Blacklist-Einträge aufräumen
    for (const [t, exp] of targetBlacklist.entries()) {
      if (now > exp) targetBlacklist.delete(t);
    }

    const realFreeRam = getNetworkRealFreeRam(ns, servers);
    const queueRam = getQueueRam(ns, eventQueue);
    const virtualFreeRam = realFreeRam - queueRam;

    // 🚀 FAST-CHECK: Aktive Batches via Set-Größe ermitteln (O(1) statt O(N))

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
          if (eventQueue.length > 0) {
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

        activeBatchIds.add(bId);
        batchEventCounts.set(bId, validEvents.length);

        batchesSentForTarget++;

        nextAvailableLandTime += Math.max(BATCH_GAP, SPACER * 4);

        if (activePlan.hackThreads === 0) {
          prepEndTime = now + activePlan.weakenTime + 1000;
        }

        patchState(ns, {
          batcherTarget: target,
          batcherProgress: `JIT-HWGW Active (${activeBatchesCount + 1}/${dynamicMaxBatchesForTarget} Batches)`,
          batcherPlan: activePlan,
          batcherDynamicMaxBatches: dynamicMaxBatchesForTarget, // 👈 Neu
          batcherRamNeeded: activePlan.totalRam * dynamicMaxBatchesForTarget, // 👈 Neu
        });
      } else if (eventQueue.length === 0) {
        logger.warn(
          `⚠️ RAM erschöpft für ${target} (Frei: ${virtualFreeRam.toFixed(1)}GB). Target-Reset.`,
        );

        // 💥 FIX: Target kurzzeitig sperren (15 Sek.), damit ein anderes Ziel gewählt werden kann
        targetBlacklist.set(target, now + 15000);

        target = null;
        activePlan = null;
        prepEndTime = 0;
        nextAvailableLandTime = 0;
        await ns.sleep(3000);
        continue;
      }
    }

    // JIT Dispatch Loop
    while (eventQueue.length > 0 && Date.now() >= eventQueue[0].startTime) {
      const event = eventQueue.shift()!;
      const lag = Date.now() - event.startTime;

      // O(1) Tracking aktualisieren
      const remaining = (batchEventCounts.get(event.batchId) ?? 1) - 1;
      if (remaining <= 0) {
        batchEventCounts.delete(event.batchId);
        activeBatchIds.delete(event.batchId);
      } else {
        batchEventCounts.set(event.batchId, remaining);
      }

      if (lag > 60) {
        logger.warn(
          `⏳ Lag (${Math.round(lag)}ms) bei Event ${event.id}. Batch verworfen.`,
        );
        pruneBatch(eventQueue, event.batchId);
        activeBatchIds.delete(event.batchId);
        batchEventCounts.delete(event.batchId);
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

        const filteredQueue = eventQueue.filter(
          (ev) => ev.target !== event.target,
        );
        eventQueue.length = 0;
        eventQueue.push(...filteredQueue);
        activeBatchIds.clear();
        batchEventCounts.clear();

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
