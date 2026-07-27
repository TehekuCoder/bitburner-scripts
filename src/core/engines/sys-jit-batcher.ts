import { NS, BitNodeMultipliers } from "@ns";
import { internalPlanner } from "utils/internal-planner.js";
import {
  getAvailableWorkers,
  executeOnWorkers,
  insertEventSorted,
  pruneBatchFromQueue,
  killWorkerPayloads,
  syncPayloads,
  createBatchEvents,
  cleanupActiveBatches,
} from "lib/worker-executor.js";
import { formatTime } from "lib/format.js";
import { SPACER, BATCH_GAP } from "/lib/constants";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import {
  getAllServers,
  getNetworkRealFreeRam,
  getQueueRam,
  getNetworkMaxRam,
} from "/lib/network";
import { loadBnMults, patchState } from "/lib/state.js";
import { JitEvent, ActiveBatch } from "/lib/types.js";
import { PATHS } from "/lib/paths";

type PlannerPlan = NonNullable<ReturnType<typeof internalPlanner>>;

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "JIT-Batcher");

  let bnMults: BitNodeMultipliers = loadBnMults(ns);

  patchState(ns, { batcherActive: true, batcherProgress: "Initialisiere..." });

  // 1. Initialisierung aller Nodes im Netzwerk & Säuberung alter Worker
  let servers = getAllServers(ns);
  let lastServerScan = Date.now();

  killWorkerPayloads(ns, servers);
  syncPayloads(ns, servers);

  const eventQueue: JitEvent[] = [];
  const targetBlacklist = new Map<string, number>();

  let nextAvailableLandTime = 0;
  let batchIdCounter = 0;
  let prepEndTime = 0;
  let target: string | null = (ns.args[0] as string) || null;
  let dynamicMaxBatchesForTarget = 100;
  let batchesSentForTarget = 0;
  let activePlan: PlannerPlan | null = null;
  let lastTimerPatchTime = 0;

  let lastHeartbeatTime = 0;
  let lastRamThrottleLogTime = 0;

  const activeBatchIds = new Set<number>();
  const activeBatches = new Map<number, ActiveBatch>();

  let lastHackingLevel = ns.getHackingLevel();

  function resetBatcherState() {
    logger.debug(`🔄 state.reset() ausgelöst. Vorheriges Target: ${target ?? "Keines"}`);

    killWorkerPayloads(ns, servers);

    target = null;
    activePlan = null;
    eventQueue.length = 0;
    activeBatchIds.clear();
    activeBatches.clear();
    nextAvailableLandTime = 0;
    prepEndTime = 0;
    batchesSentForTarget = 0;
  }

  logger.debug("🚀 JIT-Batcher gestartet. Überwachung aktiv.");

  while (true) {
    const now = Date.now();

    // ----------------------------------------------------------------------
    // 🧹 BATCH-ABSCHLUSS & CLEANUP
    // ----------------------------------------------------------------------
    const isPrepBatch = activePlan ? activePlan.hackThreads === 0 : false;
    cleanupActiveBatches(activeBatches, activeBatchIds, now, isPrepBatch, logger);

    // ----------------------------------------------------------------------
    // 🧹 PREP-ENDE CHECK
    // ----------------------------------------------------------------------
    if (
      activePlan &&
      activePlan.hackThreads === 0 &&
      batchesSentForTarget > 0 &&
      activeBatchIds.size === 0 &&
      eventQueue.length === 0
    ) {
      logger.debug(`✨ Prep-Phase für ${target} abgeschlossen. Evaluiere neuen Plan...`);
      activePlan = null;
      prepEndTime = 0;
      nextAvailableLandTime = 0;
    }

    const isPrepping = now < prepEndTime && activeBatchIds.size > 0;

    if (now - lastServerScan > 10000) {
      servers = getAllServers(ns);
      syncPayloads(ns, servers);
      bnMults = loadBnMults(ns);
      lastServerScan = now;
    }

    // ----------------------------------------------------------------------
    // 🛡️ 0. LEVEL-UP PRÜFUNG & QUEUE-FLUSH
    // ----------------------------------------------------------------------
    const currentLevel = ns.getHackingLevel();
    const levelDelta = currentLevel - lastHackingLevel;

    const isMajorLevelUp =
      levelDelta >= 100 ||
      (lastHackingLevel > 0 && levelDelta / lastHackingLevel > 0.15);

    if (isMajorLevelUp && !isPrepping) {
      logger.warn(
        `⬆️ Signifikanter Level-Up! (${lastHackingLevel} -> ${currentLevel} | Delta: +${levelDelta}). Flushe Queue & Reset...`,
      );
      lastHackingLevel = currentLevel;
      resetBatcherState();
    }

    // ----------------------------------------------------------------------
    // 🩺 1. HEALTH-CHECK
    // ----------------------------------------------------------------------
    const isHWGWActive = activePlan && activePlan.hackThreads > 0;

    if (target && !isPrepping && isHWGWActive) {
      const currentSec = ns.getServerSecurityLevel(target);
      const minSec = ns.getServerMinSecurityLevel(target);
      const secDiff = currentSec - minSec;

      if (secDiff > 15.0) {
        logger.warn(
          `⚠️ Target ${target} kritisch desynchronisiert! Sec-Abweichung: +${secDiff.toFixed(2)}. Stoppe Batches & Re-Prep...`,
        );
        killWorkerPayloads(ns, servers);
        resetBatcherState();
      }
    }

    for (const [t, exp] of targetBlacklist.entries()) {
      if (now > exp) {
        targetBlacklist.delete(t);
        logger.debug(`🔓 Target ${t} ist nicht mehr auf der Blacklist.`);
      }
    }

    const realFreeRam = getNetworkRealFreeRam(ns, servers);
    const queueRam = getQueueRam(ns, eventQueue);
    const virtualFreeRam = realFreeRam - queueRam;

    // ----------------------------------------------------------------------
    // 💓 PERIODISCHER HEARTBEAT-LOG
    // ----------------------------------------------------------------------
    if (now - lastHeartbeatTime > 5000) {
      lastHeartbeatTime = now;
      logger.debug(
        `💓 [HEARTBEAT] Target: ${target ?? "KEINES"} | Prepping: ${isPrepping} | ` +
          `ActiveBatches: ${activeBatchIds.size}/${dynamicMaxBatchesForTarget} | ` +
          `Queue: ${eventQueue.length} Events (${queueRam.toFixed(1)}GB) | ` +
          `VirtFreeRam: ${virtualFreeRam.toFixed(1)}GB / MaxNet: ${getNetworkMaxRam(ns, servers).toFixed(1)}GB`,
      );
    }

    // ----------------------------------------------------------------------
    // 🔍 PLANNER EVALUIERUNG
    // ----------------------------------------------------------------------
    const needsNewPlan = !target || !activePlan;

    if (needsNewPlan && !isPrepping) {
      logger.debug(
        `🔍 Rufe internalPlanner auf... (Target: ${target ?? "null"}, VirtRAM: ${virtualFreeRam.toFixed(1)}GB, Blacklist: ${targetBlacklist.size})`,
      );

      const candidateServers = servers.filter((s) => !targetBlacklist.has(s));

      const planning = internalPlanner(
        ns,
        candidateServers,
        getNetworkMaxRam(ns, servers),
        virtualFreeRam,
        bnMults,
      );

      if (planning) {
        if (target && planning.target !== target) {
          if (eventQueue.length > 0) {
            logger.debug(
              `⏳ Zielwechsel steht an... Lass Queue auslaufen (${eventQueue.length} verbleibend)`,
            );
            await ns.sleep(100);
            continue;
          } else {
            resetBatcherState();
            logger.debug(`🚀 JIT Wechsel auf Ziel: ${planning.target}`);
          }
        }

        target = planning.target;
        activePlan = planning;
        lastHackingLevel = ns.getHackingLevel();
        dynamicMaxBatchesForTarget = planning.maxBatches;
        batchesSentForTarget = 0;
        nextAvailableLandTime = 0;

        const mode = planning.hackThreads === 0 ? "PREP" : "HWGW";
        const planRam = planning.batchRam;
        logger.debug(
          `📋 JIT-Plan geladen: ${target} [${mode}] | RAM/Batch: ${planRam.toFixed(1)}GB | ` +
            `Threads (H/W1/G/W2): ${planning.hackThreads}/${planning.weaken1Threads}/${planning.growThreads}/${planning.weaken2Threads} | ` +
            `Max Batches: ${dynamicMaxBatchesForTarget}`,
        );
      } else {
        logger.debug(`⚠️ internalPlanner lieferte NULL. Kein geeignetes Ziel / RAM zu knapp.`);
      }

      if (!target || !activePlan) {
        let minExp = Infinity;
        for (const exp of targetBlacklist.values()) {
          if (exp > now && exp < minExp) minExp = exp;
        }

        let searchStatus = "Suche optimales Target...";
        if (minExp !== Infinity) {
          const remainingSec = Math.ceil((minExp - now) / 1000);
          searchStatus = `Suche optimales Target... (Cooldown: ${formatTime(remainingSec)})`;
        }

        patchState(ns, {
          batcherProgress: searchStatus,
          batcherTarget: "Suche...",
          kernelTarget: "Suche...",
          batcherPlan: null,
        });
        await ns.sleep(1000);
        continue;
      }
    }

    // ----------------------------------------------------------------------
    // ⏱️ LIVE PREP-TIMER UPDATE
    // ----------------------------------------------------------------------
    if (isPrepping && now - lastTimerPatchTime >= 1000) {
      lastTimerPatchTime = now;
      const remainingPrepSec = Math.max(0, Math.ceil((prepEndTime - now) / 1000));
      patchState(ns, {
        batcherProgress: `Prep-Phase Active (${formatTime(remainingPrepSec)} verbleibend)`,
      });
    }

    // ----------------------------------------------------------------------
    // 📥 2. EVENT-QUEUE BEFÜLLEN
    // ----------------------------------------------------------------------
    if (target && activePlan && activeBatchIds.size < dynamicMaxBatchesForTarget) {
      const plan = activePlan;
      const isPrep = plan.hackThreads === 0;
      const ramMultiplier = isPrep ? 0.95 : 0.8;
      const batchGap = Math.max(BATCH_GAP, SPACER * 4);
      const planRam = plan.batchRam;

      let batchesQueuedThisLoop = 0;

      while (target && activePlan && activeBatchIds.size < dynamicMaxBatchesForTarget) {
        const currentQueueRam = getQueueRam(ns, eventQueue);
        const safeVirtualRam = (realFreeRam - currentQueueRam) * ramMultiplier;

        if (safeVirtualRam < planRam) {
          if (now - lastRamThrottleLogTime > 4000) {
            lastRamThrottleLogTime = now;
            logger.debug(
              `⏸️ Warten auf RAM zum Queuen von b${batchIdCounter}: ` +
                `Benötigt=${planRam.toFixed(1)}GB | Verfügbar=${safeVirtualRam.toFixed(1)}GB (RealFree=${realFreeRam.toFixed(1)}GB, QueueRam=${currentQueueRam.toFixed(1)}GB)`,
            );
          }
          break;
        }

        if (nextAvailableLandTime < now + plan.weakenTime + 500) {
          nextAvailableLandTime = now + plan.weakenTime + 500;
        }

        const bId = batchIdCounter++;
        const tLand = nextAvailableLandTime;

        // Ausgelagerte Event-Erstellung
        const validEvents = createBatchEvents(bId, target, tLand, plan);

        for (const ev of validEvents) {
          insertEventSorted(eventQueue, ev);
        }

        activeBatchIds.add(bId);
        activeBatches.set(bId, {
          id: bId,
          executedEventsCount: 0,
          totalEventsCount: validEvents.length,
          landEndTime: tLand + 2 * SPACER,
        });

        batchesSentForTarget++;
        batchesQueuedThisLoop++;
        nextAvailableLandTime += batchGap;

        if (isPrep) {
          prepEndTime = Math.max(prepEndTime, tLand + 1000);
        }

        if (activeBatchIds.size === dynamicMaxBatchesForTarget) {
          logger.info(
            `🚀 Batch-Pipeline gefüllt: ${activeBatchIds.size}/${dynamicMaxBatchesForTarget} Batches aktiv für ${target}.`,
          );
        }
      }

      if (batchesQueuedThisLoop > 0 && target && activePlan) {
        const remainingPrepSec = isPrep ? Math.max(0, Math.ceil((prepEndTime - now) / 1000)) : 0;
        const progressMsg = isPrep
          ? `Prep-Phase Active (${formatTime(remainingPrepSec)} verbleibend)`
          : `JIT-HWGW Active (${activeBatchIds.size}/${dynamicMaxBatchesForTarget} Batches)`;

        patchState(ns, {
          batcherTarget: target,
          kernelTarget: target,
          batcherProgress: progressMsg,
          batcherPlan: activePlan,
          batcherDynamicMaxBatches: dynamicMaxBatchesForTarget,
          batcherRamNeeded: planRam * dynamicMaxBatchesForTarget,
        });
      }
    }

    // ----------------------------------------------------------------------
    // ⚡ 3. JIT DISPATCH LOOP
    // ----------------------------------------------------------------------
    if (eventQueue.length > 0 && Date.now() >= eventQueue[0].startTime) {
      const workers = getAvailableWorkers(ns, servers);

      while (eventQueue.length > 0 && Date.now() >= eventQueue[0].startTime) {
        const event = eventQueue.shift()!;
        const lag = Date.now() - event.startTime;
        const batchState = activeBatches.get(event.batchId);

        if (lag > 90) {
          logger.warn(`⏳ Lag-Pruning bei Event ${event.id}`);
          if (batchState && batchState.executedEventsCount > 0) {
            targetBlacklist.set(event.target, now + 15000);
            resetBatcherState();
            break;
          } else {
            pruneBatchFromQueue(eventQueue, event.batchId);
            activeBatchIds.delete(event.batchId);
            activeBatches.delete(event.batchId);
            continue;
          }
        }

        const dispatched = executeOnWorkers(ns, event, workers);

        if (dispatched) {
          if (batchState) batchState.executedEventsCount++;
        } else {
          logger.error(`🛑 Execution-Fehler bei ${event.target}. Recovery...`);
          targetBlacklist.set(event.target, now + 45000);

          if (target === event.target) {
            resetBatcherState();
          } else {
            const filteredQueue = eventQueue.filter((ev) => ev.target !== event.target);
            eventQueue.length = 0;
            eventQueue.push(...filteredQueue);
          }

          await ns.sleep(3000);
          break;
        }
      }
    }

    // ----------------------------------------------------------------------
    // ⏱️ PRECISION SLEEP MANAGEMENT
    // ----------------------------------------------------------------------
    if (eventQueue.length > 0) {
      const timeToNext = eventQueue[0].startTime - Date.now();
      await ns.sleep(Math.min(50, Math.max(1, timeToNext)));
    } else {
      await ns.sleep(50);
    }
  }
}