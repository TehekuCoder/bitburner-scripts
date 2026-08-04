import { NS, BitNodeMultipliers } from "@ns";
import { internalPlanner } from "/lib/utils/internal-planner.js";
import {
  getAvailableWorkers,
  executeOnWorkers,
  killWorkerPayloads,
  syncPayloads,
} from "/lib/worker-executor.js";
import {
  cleanupActiveBatches,
  createBatchEvents,
  insertEventSorted,
  updateDynamicBatchCaps,
  checkTargetEviction,
  getDynamicMaxTargets,
  getAdaptiveBatchGap,
} from "/lib/batcher-helpers.js";
import { SPACER } from "/lib/constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import {
  getAllServers,
  getNetworkRealFreeRam,
  getQueueRam,
  getNetworkMaxRam,
} from "/lib/network.js";
import { ActiveBatch, JitEvent, TargetContext } from "/lib/types/batcher.js";
import { patchBatcherState } from "/lib/state.js";
import { loadBnMults } from "/lib/utils.js";


type PlannerPlan = NonNullable<ReturnType<typeof internalPlanner>>;



const MAX_SAFE_CONCURRENT_SCRIPTS = 10000;

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "JIT-Batcher");

  let bnMults: BitNodeMultipliers = loadBnMults(ns);
  patchBatcherState(ns, { batcherActive: true, batcherProgress: "Initialisiere..." });

  let servers = getAllServers(ns);
  let lastServerScan = Date.now();

  killWorkerPayloads(ns, servers);
  syncPayloads(ns, servers);

  const eventQueue: JitEvent[] = [];
  const activeBatches = new Map<number, ActiveBatch>();
  const activeBatchIdsSet = new Set<number>();
  const targetBlacklist = new Map<string, number>();
  const activeTargets = new Map<string, TargetContext>();

  let batchIdCounter = 0;
  let lastHackingLevel = ns.getHackingLevel();
  let lastHeartbeatTime = 0;
  let lastRamThrottleLogTime = 0;
  let lastEvictionCheck = 0;
  let lastPlannerRunTime = 0; // ⏱️ Intervall für Planner
  let rollingLag = 0;

  function removeTarget(targetName: string, reason: string): void {
    const ctx = activeTargets.get(targetName);
    if (!ctx) return;

    let writeIndex = 0;
    for (let readIndex = 0; readIndex < eventQueue.length; readIndex++) {
      if (eventQueue[readIndex].target !== targetName) {
        eventQueue[writeIndex] = eventQueue[readIndex];
        writeIndex++;
      }
    }
    eventQueue.length = writeIndex;

    for (const bId of ctx.activeBatchIds) {
      activeBatches.delete(bId);
      activeBatchIdsSet.delete(bId);
    }

    activeTargets.delete(targetName);
    logger.warn(`🛑 Ziel [${targetName}] isoliert zurückgesetzt: ${reason}`, targetName);
  }

  function resetAllTargets(reason: string): void {
    logger.warn(`🔄 Globaler State-Reset ausgelöst: ${reason}`);
    killWorkerPayloads(ns, servers);
    activeTargets.clear();
    eventQueue.length = 0;
    activeBatches.clear();
    activeBatchIdsSet.clear();
  }

  logger.info("🚀 Multi-Target JIT-Batcher Daemon erfolgreich gestartet.");

  while (true) {
    const now = Date.now();

    // 🧹 1. BATCH-ABSCHLUSS & CLEANUP
    for (const ctx of activeTargets.values()) {
      const isPrepBatch = ctx.plan.hackThreads === 0;
      cleanupActiveBatches(
        activeBatches,
        activeBatchIdsSet,
        now,
        isPrepBatch,
        logger,
      );

      // Direkte Set-Bereinigung ohne Array.from Allokation
      for (const bId of ctx.activeBatchIds) {
        if (!activeBatchIdsSet.has(bId)) {
          ctx.activeBatchIds.delete(bId);
        }
      }

      if (
        isPrepBatch &&
        ctx.batchesSent > 0 &&
        ctx.activeBatchIds.size === 0 &&
        !eventQueue.some((ev) => ev.target === ctx.target)
      ) {
        logger.success(
          `✨ Prep-Phase beendet! Target ${ctx.target} ist vollständig präpariert.`,
          ctx.target,
        );
        removeTarget(ctx.target, "Prep abgeschlossen – Re-Evaluation für HWGW");
      }
    }

    if (now - lastServerScan > 10000) {
      servers = getAllServers(ns);
      syncPayloads(ns, servers);
      bnMults = loadBnMults(ns);
      lastServerScan = now;
    }

    // 🛡️ 2. LEVEL-UP PRÜFUNG
    const currentLevel = ns.getHackingLevel();
    const levelDelta = currentLevel - lastHackingLevel;
    const minAbsDelta = Math.max(100, Math.floor(lastHackingLevel * 0.05));

    if (levelDelta >= minAbsDelta) {
      lastHackingLevel = currentLevel;
      resetAllTargets(`Major Level-Up (${currentLevel - levelDelta} -> ${currentLevel})`);
    }

    // 🩺 3. HEALTH-CHECK (Kein Array.from nötig)
    for (const ctx of activeTargets.values()) {
      const isPrepping = now < ctx.prepEndTime && ctx.activeBatchIds.size > 0;
      const isHWGWActive = ctx.plan.hackThreads > 0;

      if (!isPrepping && isHWGWActive) {
        const currentSec = ns.getServerSecurityLevel(ctx.target);
        const minSec = ns.getServerMinSecurityLevel(ctx.target);
        const secDiff = currentSec - minSec;

        if (secDiff > 0.5) {
          targetBlacklist.set(ctx.target, now + 45000);
          removeTarget(ctx.target, `Desynchronisation (+${secDiff.toFixed(2)} Sec)`);
        }
      }
    }

    for (const [t, exp] of targetBlacklist.entries()) {
      if (now > exp) {
        targetBlacklist.delete(t);
        logger.debug(`🔓 Blacklist abgelaufen für: ${t}`, t);
      }
    }

    const totalNetworkMaxRam = getNetworkMaxRam(ns, servers);
    const realFreeRam = getNetworkRealFreeRam(ns, servers);
    const queueRam = getQueueRam(ns, eventQueue);
    const virtualFreeRam = realFreeRam - queueRam;

    // 💓 HEARTBEAT-LOG
    if (now - lastHeartbeatTime > 10000) {
      lastHeartbeatTime = now;
      const targetNames = Array.from(activeTargets.keys()).join(", ") || "Keine";
      logger.debug(
        `💓 Ziele: [${targetNames}] | Queue: ${eventQueue.length} (${queueRam.toFixed(0)}GB) | Lag: ${rollingLag.toFixed(1)}ms | Freier RAM: ${virtualFreeRam.toFixed(0)}GB`,
      );
    }

    // 🔄 4. TARGET EVICTION CHECK (ALLE 20s)
    const dynamicMaxTargets = getDynamicMaxTargets(totalNetworkMaxRam, currentLevel);

    if (now - lastEvictionCheck > 20000 && activeTargets.size >= dynamicMaxTargets) {
      const candidateServers = servers.filter((s) => !targetBlacklist.has(s) && !activeTargets.has(s));
      checkTargetEviction(ns, activeTargets, candidateServers, virtualFreeRam, bnMults, logger, removeTarget);
      lastEvictionCheck = now;
    }

    // ⚖️ 5. DYNAMISCHE RAM-VERTEILUNG
    updateDynamicBatchCaps(activeTargets, virtualFreeRam, MAX_SAFE_CONCURRENT_SCRIPTS);

    // 🔍 6. MULTI-TARGET PLANNER EVALUIERUNG (Getrottelt auf max. 1x pro Sekunde)
    if (
      now - lastPlannerRunTime > 1000 &&
      activeTargets.size < dynamicMaxTargets &&
      virtualFreeRam > 10
    ) {
      lastPlannerRunTime = now;
      const candidateServers = servers.filter((s) => !targetBlacklist.has(s) && !activeTargets.has(s));

      const planning = internalPlanner(
        ns,
        candidateServers,
        totalNetworkMaxRam,
        virtualFreeRam,
        bnMults,
        ns.getPlayer(),
        logger,
      );

      if (planning && !activeTargets.has(planning.target)) {
        activeTargets.set(planning.target, {
          target: planning.target,
          plan: planning,
          dynamicMaxBatches: planning.maxBatches,
          batchesSent: 0,
          nextAvailableLandTime: 0,
          prepEndTime: 0,
          activeBatchIds: new Set(),
        });

        const mode = planning.hackThreads === 0 ? "PREP" : "HWGW";
        logger.info(
          `🎯 Ziel hinzugenommen: [${planning.target}] Mode: ${mode} | Max Batches: ${planning.maxBatches}`,
          planning.target,
        );
      }
    }

    // 📥 7. EVENT-QUEUE BEFÜLLEN
    const currentAdaptiveGap = getAdaptiveBatchGap(rollingLag);

    for (const ctx of activeTargets.values()) {
      const plan = ctx.plan;
      const isPrep = plan.hackThreads === 0;
      const ramMultiplier = isPrep ? 0.95 : 0.8;
      const batchGap = Math.max(currentAdaptiveGap, SPACER * 4);
      const planRam = plan.batchRam;

      while (ctx.activeBatchIds.size < ctx.dynamicMaxBatches) {
        const currentQueueRam = getQueueRam(ns, eventQueue);
        const safeVirtualRam = (realFreeRam - currentQueueRam) * ramMultiplier;

        if (safeVirtualRam < planRam) {
          if (now - lastRamThrottleLogTime > 5000) {
            lastRamThrottleLogTime = now;
            logger.debug(
              `⏸️ RAM-Engpass für ${ctx.target}. Benötigt: ${planRam.toFixed(1)}GB | Frei: ${safeVirtualRam.toFixed(1)}GB`,
              ctx.target,
            );
          }
          break;
        }

        if (ctx.nextAvailableLandTime < now + plan.weakenTime + 500) {
          ctx.nextAvailableLandTime = now + plan.weakenTime + 500;
        }

        const bId = batchIdCounter++;
        const tLand = ctx.nextAvailableLandTime;
        const validEvents = createBatchEvents(bId, ctx.target, tLand, plan);

        for (const ev of validEvents) {
          insertEventSorted(eventQueue, ev);
        }

        activeBatchIdsSet.add(bId);
        ctx.activeBatchIds.add(bId);
        activeBatches.set(bId, {
          id: bId,
          executedEventsCount: 0,
          totalEventsCount: validEvents.length,
          landEndTime: tLand + 2 * SPACER,
        });

        ctx.batchesSent++;
        ctx.nextAvailableLandTime += batchGap;

        if (isPrep) {
          ctx.prepEndTime = Math.max(ctx.prepEndTime, tLand + 1000);
        }
      }
    }

    // Dashboard State Update
    patchBatcherState(ns, {
      batcherTarget: Array.from(activeTargets.keys()).join(", ") || "Suche...",
      batcherProgress: `Multi-Target (${activeTargets.size} aktiv)`,
      batcherTargetsSummary: Array.from(activeTargets.values()).map((ctx) => ({
        target: ctx.target,
        mode: ctx.plan.hackThreads === 0 ? "PREP" : "HWGW",
        activeBatches: ctx.activeBatchIds.size,
        maxBatches: ctx.dynamicMaxBatches,
        prepEndTime: ctx.prepEndTime,
        greed: (ctx.plan as { greed?: number }).greed ?? 0,
      })),
    });

    // ⚡ 8. JIT DISPATCH LOOP
    if (eventQueue.length > 0 && Date.now() >= eventQueue[0].startTime) {
      const workers = getAvailableWorkers(ns, servers);

      while (eventQueue.length > 0 && Date.now() >= eventQueue[0].startTime) {
        const event = eventQueue.shift()!;
        const lag = Date.now() - event.startTime;
        const batchState = activeBatches.get(event.batchId);

        rollingLag = rollingLag * 0.9 + lag * 0.1;

        if (lag > 150) {
          logger.warn(`⏳ Lag (${lag}ms) bei Batch b${event.batchId} [${event.target}].`, event.target);
          if (batchState && batchState.executedEventsCount > 0) {
            targetBlacklist.set(event.target, now + 5000);
            removeTarget(event.target, "Event verworfen wegen Lag");
            break;
          } else {
            activeBatches.delete(event.batchId);
            activeBatchIdsSet.delete(event.batchId);
            const ctx = activeTargets.get(event.target);
            if (ctx) ctx.activeBatchIds.delete(event.batchId);
            continue;
          }
        }

        const dispatched = executeOnWorkers(ns, event, workers);

        if (dispatched) {
          if (batchState) batchState.executedEventsCount++;
        } else {
          logger.error(`🛑 Ausführungsfehler auf Workers für ${event.target}. Target isoliert pausiert.`, event.target);
          targetBlacklist.set(event.target, now + 45000);
          removeTarget(event.target, "Worker Exec Error");
          break;
        }
      }
    }

    // ⏱️ PRECISION SLEEP
    if (eventQueue.length > 0) {
      const timeToNext = eventQueue[0].startTime - Date.now();
      await ns.sleep(Math.min(50, Math.max(1, timeToNext)));
    } else {
      await ns.sleep(50);
    }
  }
}