import { NS } from "@ns";
import { internalPlanner } from "utils/internal-planner.js";
import {
  getAvailableWorkers,
  executeOnWorkers,
  insertEventSorted,
  pruneBatchFromQueue,
} from "lib/worker-executor.js";
import {
  PATH_HACK,
  PATH_GROW,
  PATH_WEAKEN,
  SPACER,
  BATCH_GAP,
} from "/lib/constants";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import {
  getAllServers,
  getNetworkRealFreeRam,
  getQueueRam,
  getNetworkMaxRam,
} from "/lib/network";
import { loadBnMults, patchState } from "/lib/state.js";
import { JitEvent, BatchPlan, ActiveBatch } from "/lib/types.js";

/** Formatiert Sekunden in ein lesbares Format (z.B. "1m 15s" oder "45s") */
function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s < 10 ? "0" : ""}${s}s`;
}

/**
 * Killt gezielt nur Worker-Payloads auf ALLEN Servern (inklusive home),
 * ohne den Batcher, den Orchestrator oder Daemons zu beenden.
 */
function killWorkerPayloads(ns: NS, servers: string[]): void {
  const payloadScripts = [PATH_HACK, PATH_GROW, PATH_WEAKEN];
  for (const server of servers) {
    if (!ns.hasRootAccess(server)) continue;
    for (const proc of ns.ps(server)) {
      if (payloadScripts.some((path) => proc.filename.includes(path))) {
        ns.kill(proc.pid);
      }
    }
  }
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "JIT-Batcher");

  let bnMults = loadBnMults(ns);

  patchState(ns, { batcherActive: true, batcherProgress: "Initialisiere..." });

  // 1. Initialisierung aller Nodes im Netzwerk & Säuberung alter Worker
  let servers = getAllServers(ns);
  let lastServerScan = Date.now();

  killWorkerPayloads(ns, servers);
  syncPayloads(servers);

  const eventQueue: JitEvent[] = [];
  const targetBlacklist = new Map<string, number>();

  let nextAvailableLandTime = 0;
  let batchIdCounter = 0;
  let prepEndTime = 0;
  let target: string | null = (ns.args[0] as string) || null;
  let dynamicMaxBatchesForTarget = 100;
  let batchesSentForTarget = 0;
  let activePlan: BatchPlan | null = null;
  let lastTimerPatchTime = 0;

  // Logging-Timer für Heartbeats & Drosselungen
  let lastHeartbeatTime = 0;
  let lastRamThrottleLogTime = 0;

  const activeBatchIds = new Set<number>();
  const activeBatches = new Map<number, ActiveBatch>();

  let lastHackingLevel = ns.getHackingLevel();

  /**
   * Setzt den internen Zustand des Batchers vollständig zurück und killt Alt-Payloads (auch auf home).
   */
  function resetBatcherState() {
    logger.debug(
      `🔄 state.reset() ausgelöst. Vorheriges Target: ${target ?? "Keines"}`,
    );

    // 🧹 Gezielte Beendigung aller aktiven H/G/W-Payloads auf allen Servern inkl. home
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

  // Hilfsfunktion zum Kopieren der Payloads auf gerootete Server
  function syncPayloads(serverList: string[]) {
    for (const s of serverList) {
      if (s !== "home" && ns.hasRootAccess(s)) {
        ns.scp([PATH_HACK, PATH_GROW, PATH_WEAKEN], s, "home");
      }
    }
  }

  logger.debug("🚀 JIT-Batcher gestartet. Überwachung aktiv.");

  while (true) {
    const now = Date.now();

    // ----------------------------------------------------------------------
    // 🧹 BATCH-ABSCHLUSS & CLEANUP
    // ----------------------------------------------------------------------
    for (const [bId, bData] of activeBatches.entries()) {
      if (now >= bData.landEndTime) {
        activeBatches.delete(bId);
        activeBatchIds.delete(bId);

        const modeLog =
          activePlan && activePlan.hackThreads === 0
            ? "Prep-Batch"
            : "HWGW-Batch";
        logger.debug(`✅ ${modeLog} b${bId} erfolgreich gelandet.`);
      } else if (now > bData.landEndTime + 3000) {
        activeBatches.delete(bId);
        activeBatchIds.delete(bId);
        logger.warn(
          `🧹 Watchdog: Batch b${bId} hing fest und wurde zwangsaufgeräumt.`,
        );
      }
    }

    // ----------------------------------------------------------------------
    // 🧹 PREP-ENDE CHECK (Sofort auslösen, wenn alle Prep-Batches gelandet sind)
    // ----------------------------------------------------------------------
    if (
      activePlan &&
      activePlan.hackThreads === 0 &&
      batchesSentForTarget > 0 &&
      activeBatchIds.size === 0 &&
      eventQueue.length === 0
    ) {
      logger.debug(
        `✨ Prep-Phase für ${target} abgeschlossen. Evaluiere neuen Plan...`,
      );
      activePlan = null;
      prepEndTime = 0;
      nextAvailableLandTime = 0;
    }

    // Dynamic prep check: Nur "prepping", wenn auch wirklich noch Prep-Batches in der Luft sind
    const isPrepping = now < prepEndTime && activeBatchIds.size > 0;

    // Server-Netzwerk scannen und Payloads nachliefern
    if (now - lastServerScan > 10000) {
      servers = getAllServers(ns);
      syncPayloads(servers);
      bnMults = loadBnMults(ns);
      lastServerScan = now;
    }

    // ----------------------------------------------------------------------
    // 🛡️ 0. LEVEL-UP PRÜFUNG & QUEUE-FLUSH
    // ----------------------------------------------------------------------
    const currentLevel = ns.getHackingLevel();
    const levelDelta = currentLevel - lastHackingLevel;

    // Erst ab +100 Leveln ODER mehr als 15% Zuwachs flushen
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
    // 🩺 1. HEALTH-CHECK (Gezielter Schutz vor echten Crashes/Desyncs)
    // ----------------------------------------------------------------------
    const isHWGWActive = activePlan && activePlan.hackThreads > 0;

    if (target && !isPrepping && isHWGWActive) {
      const currentSec = ns.getServerSecurityLevel(target);
      const minSec = ns.getServerMinSecurityLevel(target);
      const secDiff = currentSec - minSec;

      // HWGW-Wellen haben durch vorausfliegende Hacks/Grows natürliche Security-Spikes:
      if (secDiff > 15.0) {
        logger.warn(
          `⚠️ Target ${target} kritisch desynchronisiert! Sec-Abweichung: +${secDiff.toFixed(2)}. Stoppe Batches & Re-Prep...`,
        );
        killWorkerPayloads(ns, servers);
        resetBatcherState();
      }
    }

    // Abgelaufene Blacklist-Einträge aufräumen
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
        activePlan = planning.plan;
        lastHackingLevel = ns.getHackingLevel();
        dynamicMaxBatchesForTarget = planning.maxBatches;
        batchesSentForTarget = 0;
        nextAvailableLandTime = 0;

        const mode = activePlan?.hackThreads === 0 ? "PREP" : "HWGW";
        logger.debug(
          `📋 JIT-Plan geladen: ${target} [${mode}] | RAM/Batch: ${activePlan?.totalRam.toFixed(1)}GB | ` +
            `Threads (H/W1/G/W2): ${activePlan?.hackThreads}/${activePlan?.weaken1Threads}/${activePlan?.growThreads}/${activePlan?.weaken2Threads} | ` +
            `Max Batches: ${dynamicMaxBatchesForTarget}`,
        );
      } else {
        logger.debug(
          `⚠️ internalPlanner lieferte NULL. Kein geeignetes Ziel / RAM zu knapp.`,
        );
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
      const remainingPrepSec = Math.max(
        0,
        Math.ceil((prepEndTime - now) / 1000),
      );
      patchState(ns, {
        batcherProgress: `Prep-Phase Active (${formatTime(remainingPrepSec)} verbleibend)`,
      });
    }

    // ----------------------------------------------------------------------
    // 📥 2. EVENT-QUEUE BEFÜLLEN (Schnelles Pipeline-Filling via Loop)
    // ----------------------------------------------------------------------
    if (
      target &&
      activePlan &&
      activeBatchIds.size < dynamicMaxBatchesForTarget
    ) {
      const isPrepBatch = activePlan.hackThreads === 0;
      const ramMultiplier = isPrepBatch ? 0.95 : 0.8;
      const batchGap = Math.max(BATCH_GAP, SPACER * 4);

      while (
        target &&
        activePlan &&
        activeBatchIds.size < dynamicMaxBatchesForTarget
      ) {
        const currentQueueRam = getQueueRam(ns, eventQueue);
        const safeVirtualRam = (realFreeRam - currentQueueRam) * ramMultiplier;

        if (safeVirtualRam < activePlan.totalRam) {
          if (now - lastRamThrottleLogTime > 4000) {
            lastRamThrottleLogTime = now;
            logger.debug(
              `⏸️ Warten auf RAM zum Queuen von b${batchIdCounter}: ` +
                `Benötigt=${activePlan.totalRam.toFixed(1)}GB | Verfügbar=${safeVirtualRam.toFixed(1)}GB (RealFree=${realFreeRam.toFixed(1)}GB, QueueRam=${currentQueueRam.toFixed(1)}GB)`,
            );
          }

          if (eventQueue.length === 0 && activeBatchIds.size === 0) {
            logger.warn(
              `⚠️ RAM erschöpft für ${target} (Frei: ${safeVirtualRam.toFixed(1)}GB, Benötigt: ${activePlan.totalRam.toFixed(1)}GB). Target-Reset.`,
            );

            targetBlacklist.set(target, now + 15000);
            resetBatcherState();
            await ns.sleep(3000);
          }
          break;
        }

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

        const modeText = isPrepBatch ? "Prep-Batch" : "HWGW-Batch";
        const eta = (activePlan.weakenTime / 1000).toFixed(0);

        logger.debug(
          `[Batcher] 🚀 ${modeText} #${bId} für ${activePlan.target} eingereiht! ETA: ${eta}s`,
        );

        batchesSentForTarget++;
        nextAvailableLandTime += batchGap;

        if (isPrepBatch) {
          prepEndTime = Math.max(prepEndTime, tLand + 1000);
        }

        const remainingPrepSec = isPrepBatch
          ? Math.max(0, Math.ceil((prepEndTime - now) / 1000))
          : 0;

        const progressMsg = isPrepBatch
          ? `Prep-Phase Active (${formatTime(remainingPrepSec)} verbleibend)`
          : `JIT-HWGW Active (${activeBatchIds.size}/${dynamicMaxBatchesForTarget} Batches)`;

        logger.debug(
          `➕ Batch b${bId} gequeuet. Target: ${target} | Landezeit: ${new Date(tLand).toLocaleTimeString()} | Queue-Size: ${eventQueue.length}`,
        );

        // Nur einmal loggen, wenn die Welle vollgepumpt wurde:
        if (activeBatchIds.size === dynamicMaxBatchesForTarget) {
          logger.info(
            `🚀 Batch-Pipeline gefüllt: ${activeBatchIds.size}/${dynamicMaxBatchesForTarget} Batches aktiv für ${target}.`,
          );
        }

        patchState(ns, {
          batcherTarget: target,
          kernelTarget: target,
          batcherProgress: progressMsg,
          batcherPlan: activePlan,
          batcherDynamicMaxBatches: dynamicMaxBatchesForTarget,
          batcherRamNeeded: activePlan.totalRam * dynamicMaxBatchesForTarget,
        });
      }
    }

    // ----------------------------------------------------------------------
    // ⚡ 3. JIT DISPATCH LOOP
    // ----------------------------------------------------------------------
    while (eventQueue.length > 0 && Date.now() >= eventQueue[0].startTime) {
      const event = eventQueue.shift()!;
      const lag = Date.now() - event.startTime;
      const batchState = activeBatches.get(event.batchId);

      if (lag > 90) {
        logger.warn(
          `⏳ Lag-Pruning (${Math.round(lag)}ms Delay) bei Event ${event.id} (${event.script} -> ${event.target})`,
        );

        if (batchState && batchState.executedEventsCount > 0) {
          logger.error(
            `💥 Batch b${event.batchId} wurde bereits partiell ausgeführt! Zwangsrücksetzung & Blacklist...`,
          );

          targetBlacklist.set(event.target, now + 15000);
          resetBatcherState();
          break;
        } else {
          pruneBatchFromQueue(eventQueue, event.batchId);
          activeBatchIds.delete(event.batchId);
          activeBatches.delete(event.batchId);
          logger.debug(
            `✂️ Verbleibende Events von Batch b${event.batchId} verworfen.`,
          );
          continue;
        }
      }

      const workers = getAvailableWorkers(ns, servers);
      const dispatched = executeOnWorkers(ns, event, workers);

      if (dispatched) {
        logger.debug(
          `⚡ Executed Event ${event.id} [${event.script}] (${event.threads}t auf Target: ${event.target})`,
        );
        if (batchState) {
          batchState.executedEventsCount++;
        }
      } else {
        logger.error(
          `🛑 Execution-Fehler / RAM-Engpass bei Worker-Verteilung für ${event.target} (Event: ${event.id}, ${event.threads}t). Recovery...`,
        );
        ns.toast(`RAM-Engpass bei ${event.target}!`, "warning", 3000);

        targetBlacklist.set(event.target, now + 45000);

        if (target === event.target) {
          resetBatcherState();
        } else {
          const filteredQueue = eventQueue.filter(
            (ev) => ev.target !== event.target,
          );
          eventQueue.length = 0;
          eventQueue.push(...filteredQueue);
        }

        patchState(ns, {
          batcherProgress: "RAM-Coolingdown... Warte auf Freigabe",
          batcherTarget: "Standby",
        });

        await ns.sleep(3000);
        break;
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
