import { NS, BitNodeMultipliers } from "@ns";
import { internalPlanner } from "../../domain/hacking/internal-planner.js";

import {
  cleanupActiveBatches,
  createBatchEvents,
  insertEventSorted,
  updateDynamicBatchCaps,
  checkTargetEviction,
  getDynamicMaxTargets,
  getAdaptiveBatchGap,
  pruneBatchFromQueue,
} from "../../domain/hacking/batcher-helpers.js";
import {
  MAX_SAFE_CONCURRENT_SCRIPTS,
  SPACER,
} from "../../infrastructure/runtime/batcher.js";
import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";
import { formatRam } from "/lib/utils.js";

import { ActiveBatch, JitEvent, TargetContext } from "/shared/types/batcher.js";

import { loadBnMults } from "/lib/utils.js";
import {
  getAllServers,
  getNetworkMaxRam,
  getNetworkRealFreeRam,
  getQueueRam,
} from "/infrastructure/network/network.js";
import {
  killWorkerPayloads,
  syncPayloads,
  getAvailableWorkers,
  executeOnWorkers,
} from "/infrastructure/runtime/worker-executor.js";
import { patchBatcherState } from "/infrastructure/state/state.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "JIT-Batcher");

  let bnMults: BitNodeMultipliers = loadBnMults(ns);
  patchBatcherState(ns, {
    batcherActive: true,
    batcherProgress: "Initialisiere...",
    batcherTarget: "Suche...",
  });

  let servers = getAllServers(ns);
  let lastServerScan = Date.now();

  killWorkerPayloads(ns, servers);
  syncPayloads(ns, servers);

  const eventQueue: JitEvent[] = [];
  const activeBatches = new Map<number, ActiveBatch>();
  const activeBatchIdsSet = new Set<number>();
  const targetBlacklist = new Map<string, number>();
  const activeTargets = new Map<string, TargetContext>();

  // 🟢 Tracker für Ziele, die gerade erst PREP abgeschlossen haben (Zeitstempel für Ablauf)
  const recentlyPreppedTargets = new Map<string, number>();

  let batchIdCounter = 0;
  let lastHackingLevel = ns.getHackingLevel();
  let lastHeartbeatTime = 0;
  let lastEvictionCheck = 0;
  let lastPlannerRunTime = 0;
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
    logger.warn(
      `🛑 Ziel [${targetName}] isoliert zurückgesetzt: ${reason}`,
      targetName,
    );
  }

  function resetAllTargets(reason: string): void {
    logger.warn(`🔄 Globaler State-Reset ausgelöst: ${reason}`);
    killWorkerPayloads(ns, servers);
    activeTargets.clear();
    eventQueue.length = 0;
    activeBatches.clear();
    activeBatchIdsSet.clear();
    recentlyPreppedTargets.clear();

    patchBatcherState(ns, {
      batcherTarget: "Reset...",
      batcherProgress: "State Reset",
      batcherRamNeeded: 0,
      batcherTargetsSummary: [],
    });
  }

  logger.info("🚀 Multi-Target JIT-Batcher Daemon erfolgreich gestartet.");

  while (true) {
    const now = Date.now();

    // 🧹 1. BATCH-ABSCHLUSS & CLEANUP
    const completedPrepTargets: { target: string; reason: string }[] = [];

    for (const ctx of activeTargets.values()) {
      const isPrepBatch = ctx.plan.hackThreads === 0;
      cleanupActiveBatches(
        activeBatches,
        activeBatchIdsSet,
        now,
        isPrepBatch,
        logger,
      );

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
          `✨ Prep-Phase beendet! Target [${ctx.target}] ist vollständig präpariert.`,
          ctx.target,
        );
        // 🟢 Ziel im Tracker hinterlegen (60 Sekunden Fenster für HWGW-Start)
        recentlyPreppedTargets.set(ctx.target, now + 60000);

        completedPrepTargets.push({
          target: ctx.target,
          reason: "Prep abgeschlossen – Re-Evaluation für HWGW",
        });
      }
    }

    for (const item of completedPrepTargets) {
      removeTarget(item.target, item.reason);
    }

    // Tracker-Cleanup für abgelaufene Einträge
    for (const [t, exp] of recentlyPreppedTargets.entries()) {
      if (now > exp) recentlyPreppedTargets.delete(t);
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
      resetAllTargets(
        `Major Level-Up (${currentLevel - levelDelta} -> ${currentLevel})`,
      );
    }

    // 🩺 3. HEALTH-CHECK
    const desyncedTargets: { target: string; reason: string }[] = [];

    for (const ctx of activeTargets.values()) {
      const isPrepping = now < ctx.prepEndTime && ctx.activeBatchIds.size > 0;
      const isHWGWActive = ctx.plan.hackThreads > 0;

      if (!isPrepping && isHWGWActive) {
        const currentSec = ns.getServerSecurityLevel(ctx.target);
        const minSec = ns.getServerMinSecurityLevel(ctx.target);
        const secDiff = currentSec - minSec;

        if (secDiff > 0.5) {
          targetBlacklist.set(ctx.target, now + 45000);
          desyncedTargets.push({
            target: ctx.target,
            reason: `Desynchronisation (+${secDiff.toFixed(2)} Sec)`,
          });
        }
      }
    }

    for (const item of desyncedTargets) {
      removeTarget(item.target, item.reason);
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

    const safetyBuffer = Math.min(16, totalNetworkMaxRam * 0.05);
    const safePlannerRam = Math.max(0, virtualFreeRam - safetyBuffer);

    // 💓 HEARTBEAT-LOG
    if (now - lastHeartbeatTime > 10000) {
      lastHeartbeatTime = now;
      const targetNames =
        Array.from(activeTargets.keys()).join(", ") || "Keine";
      logger.debug(
        `💓 Ziele: [${targetNames}] | Queue: ${eventQueue.length} (${formatRam(queueRam)}) | Lag: ${rollingLag.toFixed(1)}ms | Freier RAM: ${formatRam(virtualFreeRam)}`,
      );
    }

    // 🔄 4. TARGET EVICTION CHECK (ALLE 20s)
    const dynamicMaxTargets = getDynamicMaxTargets(
      totalNetworkMaxRam,
      currentLevel,
    );

    if (
      now - lastEvictionCheck > 20000 &&
      activeTargets.size >= dynamicMaxTargets
    ) {
      const candidateServers = servers.filter(
        (s) => !targetBlacklist.has(s) && !activeTargets.has(s),
      );
      checkTargetEviction(
        ns,
        activeTargets,
        candidateServers,
        virtualFreeRam,
        bnMults,
        logger,
        removeTarget,
        totalNetworkMaxRam,
      );
      lastEvictionCheck = now;
    }

    // ⚖️ 5. DYNAMISCHE RAM-VERTEILUNG
    const currentAdaptiveGap = getAdaptiveBatchGap(rollingLag);
    updateDynamicBatchCaps(
      activeTargets,
      virtualFreeRam,
      MAX_SAFE_CONCURRENT_SCRIPTS,
      currentAdaptiveGap,
    );

    // 🔍 6. MULTI-TARGET PLANNER EVALUIERUNG
    if (
      now - lastPlannerRunTime > 1000 &&
      activeTargets.size < dynamicMaxTargets &&
      safePlannerRam > 10
    ) {
      lastPlannerRunTime = now;
      const candidateServers = servers.filter(
        (s) => !targetBlacklist.has(s) && !activeTargets.has(s),
      );

      const planning = internalPlanner(
        ns,
        candidateServers,
        totalNetworkMaxRam,
        safePlannerRam,
        bnMults,
        ns.getPlayer(),
        logger,
      );

      if (planning && !activeTargets.has(planning.target)) {
        const isPrep = planning.hackThreads === 0;
        const isAlreadyPrepped =
          ns.getServerMoneyAvailable(planning.target) >=
            ns.getServerMaxMoney(planning.target) * 0.99 &&
          ns.getServerSecurityLevel(planning.target) <=
            ns.getServerMinSecurityLevel(planning.target) + 0.01;

        if (isPrep && isAlreadyPrepped) {
          targetBlacklist.set(planning.target, now + 60000);
          logger.debug(
            `⚠️ [${planning.target}] Bereits präpariert, aber HWGW nicht rentabel (Score=0). Auf Blacklist gesetzt.`,
            planning.target,
          );
        } else {
          // 🟢 Prp-Wechsel Erkennung
          const wasRecentlyPrepped = recentlyPreppedTargets.has(
            planning.target,
          );
          if (wasRecentlyPrepped) {
            recentlyPreppedTargets.delete(planning.target);
          }

          activeTargets.set(planning.target, {
            target: planning.target,
            plan: planning,
            dynamicMaxBatches: planning.maxBatches,
            batchesSent: 0,
            nextAvailableLandTime: 0,
            prepEndTime: 0,
            activeBatchIds: new Set(),
          });

          // 🟢 Spezifische Logging-Events für das Dashboard Event-Protokoll
          if (isPrep) {
            logger.info(
              `🛠️ PREP gestartet: [${planning.target}] | Max Batches: ${planning.maxBatches}`,
              planning.target,
            );
          } else if (wasRecentlyPrepped) {
            logger.success(
              `🔥 PHASENWECHSEL [${planning.target}]: PREP ➔ HWGW! Greed: ${((planning.greed ?? 0) * 100).toFixed(1)}% | Batches: ${planning.maxBatches}`,
              planning.target,
            );
          } else {
            logger.info(
              `🚀 HWGW gestartet: [${planning.target}] | Greed: ${((planning.greed ?? 0) * 100).toFixed(1)}% | Batches: ${planning.maxBatches}`,
              planning.target,
            );
          }
        }
      }
    }

    // 📥 7. EVENT-QUEUE BEFÜLLEN
    for (const ctx of activeTargets.values()) {
      if (ctx.ramCooldown && now < ctx.ramCooldown) continue;

      const plan = ctx.plan;
      const isPrep = plan.hackThreads === 0;
      const batchGap = Math.max(currentAdaptiveGap, SPACER * 4);
      const planRam = plan.batchRam;

      while (ctx.activeBatchIds.size < ctx.dynamicMaxBatches) {
        const currentQueueRam = getQueueRam(ns, eventQueue);
        const unreservedFreeRam = realFreeRam - currentQueueRam;

        const safeVirtualRam = Math.max(0, unreservedFreeRam - safetyBuffer);
        const effectiveRamLimit =
          ctx.activeBatchIds.size === 0 ? unreservedFreeRam : safeVirtualRam;

        if (effectiveRamLimit < planRam) {
          ctx.lastRamBlockedTime = ctx.lastRamBlockedTime ?? now;

          if (now - ctx.lastRamBlockedTime > 10000) {
            removeTarget(
              ctx.target,
              "RAM-Deadlock (Plan zu groß für freie Kapazität)",
            );
          }
          break;
        } else {
          ctx.lastRamBlockedTime = undefined;
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

    const totalRamNeeded = Array.from(activeTargets.values()).reduce(
      (sum, ctx) => sum + ctx.plan.batchRam,
      0,
    );

    patchBatcherState(ns, {
      batcherTarget: Array.from(activeTargets.keys()).join(", ") || "Suche...",
      batcherProgress: `Multi-Target (${activeTargets.size} aktiv)`,
      batcherRamNeeded: totalRamNeeded,
      batcherTargetsSummary: Array.from(activeTargets.values()).map((ctx) => ({
        target: ctx.target,
        mode: ctx.plan.hackThreads === 0 ? "PREP" : "HWGW",
        activeBatches: ctx.activeBatchIds.size,
        maxBatches: ctx.dynamicMaxBatches,
        prepEndTime: ctx.prepEndTime,
        greed: ctx.plan.greed ?? 0,
        batchRam: ctx.plan.batchRam,
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
          logger.warn(
            `⏳ Lag (${lag}ms) bei Batch b${event.batchId} [${event.target}].`,
            event.target,
          );
          if (batchState && batchState.executedEventsCount > 0) {
            targetBlacklist.set(event.target, Date.now() + 5000);
            removeTarget(event.target, "Event verworfen wegen Lag");
            break;
          } else {
            activeBatches.delete(event.batchId);
            activeBatchIdsSet.delete(event.batchId);
            const ctx = activeTargets.get(event.target);
            if (ctx) ctx.activeBatchIds.delete(event.batchId);
            pruneBatchFromQueue(eventQueue, event.batchId);
            continue;
          }
        }

        const result = executeOnWorkers(ns, event, workers);

        if (result === "SUCCESS") {
          if (batchState) batchState.executedEventsCount++;
        } else if (result === "NO_RAM") {
          const ctx = activeTargets.get(event.target);
          if (ctx) {
            ctx.activeBatchIds.delete(event.batchId);
            ctx.ramCooldown = Date.now() + 2500;
          }

          logger.warn(
            `⚠️ Temporärer RAM-Engpass bei Batch b${event.batchId} [${event.target}]. Target pausiert für 2.5s.`,
            event.target,
          );
          activeBatches.delete(event.batchId);
          activeBatchIdsSet.delete(event.batchId);
          pruneBatchFromQueue(eventQueue, event.batchId);
          break;
        } else {
          logger.error(
            `🛑 Critical Worker Exec Error für ${event.target}. Target isoliert pausiert.`,
            event.target,
          );
          targetBlacklist.set(event.target, Date.now() + 45000);
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
