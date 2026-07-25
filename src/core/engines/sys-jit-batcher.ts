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
  HOME_RAM_RESERVE,
} from "/lib/constants";
import { Logger } from "/lib/logger";
import {
  getAllServers,
  getNetworkRealFreeRam,
  getQueueRam,
  getNetworkMaxRam,
} from "/lib/network";
import { loadBnMults, patchState } from "/lib/state";
import { JitEvent, BatchPlan, ActiveBatch } from "/lib/types";

/** Formatiert Sekunden in ein lesbares Format (z.B. "1m 15s" oder "45s") */
function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s < 10 ? "0" : ""}${s}s`;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(
    ns,
    "JIT-Batcher",
    "DEBUG", // Auf "DEBUG" stellen, wenn noch mehr Details gewünscht sind
    "/logs/sys-jit-batcher.txt",
  );

  let bnMults = loadBnMults(ns);

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
   * Setzt den internen Zustand des Batchers vollständig zurück.
   */
  function resetBatcherState() {
    logger.info(
      `🔄 state.reset() ausgelöst. Vorheriges Target: ${target ?? "Keines"}`,
    );
    target = null;
    activePlan = null;
    eventQueue.length = 0;
    activeBatchIds.clear();
    activeBatches.clear();
    nextAvailableLandTime = 0;
    prepEndTime = 0;
  }

  // Hilfsfunktion zum Kopieren der Payloads auf gerootete Server
  function syncPayloads(serverList: string[]) {
    for (const s of serverList) {
      if (s !== "home" && ns.hasRootAccess(s)) {
        ns.scp([PATH_HACK, PATH_GROW, PATH_WEAKEN], s, "home");
      }
    }
  }

  // Initiales Copying
  syncPayloads(servers);

  logger.info("🚀 JIT-Batcher gestartet. Überwachung aktiv.");

  while (true) {
    const now = Date.now();

    // 🧹 ABRÄUMEN: Batches entfernen, deren Landezeit verstrichen ist
    for (const [bId, bData] of activeBatches.entries()) {
      if (now > bData.landEndTime) {
        activeBatches.delete(bId);
        activeBatchIds.delete(bId);
        logger.debug(
          `🧹 Batch b${bId} verstrich (Landzeit überschritten). Aufgeräumt.`,
        );
      }
    }

    // 🚀 CACHING: Server-Netzwerk scannen und Payloads nachliefern
    if (now - lastServerScan > 10000) {
      servers = getAllServers(ns);
      syncPayloads(servers);
      bnMults = loadBnMults(ns);
      lastServerScan = now;
    }

    const isPrepping = now < prepEndTime;

    // ----------------------------------------------------------------------
    // 🛡️ 0. LEVEL-UP PRÜFUNG & QUEUE-FLUSH
    // ----------------------------------------------------------------------
    const currentLevel = ns.getHackingLevel();
    const levelDelta = currentLevel - lastHackingLevel;

    const isMajorLevelUp =
      levelDelta >= 20 ||
      (lastHackingLevel > 0 && levelDelta / lastHackingLevel > 0.05);

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

    if (target && !isPrepping && isHWGWActive && activeBatchIds.size === 0) {
      const currentSec = ns.getServerSecurityLevel(target);
      const minSec = ns.getServerMinSecurityLevel(target);
      const currentMoney = ns.getServerMoneyAvailable(target);
      const maxMoney = ns.getServerMaxMoney(target);

      const secDiff = currentSec - minSec;
      const moneyRatio = maxMoney > 0 ? currentMoney / maxMoney : 1.0;

      if (secDiff > 1.0 || moneyRatio < 0.9) {
        logger.warn(
          `⚠️ Target ${target} desynchronisiert! Sec: ${currentSec.toFixed(2)}/+${secDiff.toFixed(2)} | Money: ${(moneyRatio * 100).toFixed(1)}%. Re-Prep wird eingeleitet...`,
        );
        resetBatcherState();
      }
    }

    // Abgelaufene Blacklist-Einträge aufräumen
    for (const [t, exp] of targetBlacklist.entries()) {
      if (now > exp) {
        targetBlacklist.delete(t);
        logger.info(`🔓 Target ${t} ist nicht mehr auf der Blacklist.`);
      }
    }

    // PREP-ENDE CHECK: Wenn Prep abgeschlossen ist, Plan zurücksetzen
    if (
      !isPrepping &&
      activePlan &&
      activePlan.hackThreads === 0 &&
      activeBatchIds.size === 0
    ) {
      logger.info(
        `✨ Prep-Phase für ${target} abgeschlossen. Evaluiere neuen HWGW-Plan...`,
      );
      activePlan = null;
    }

    const realFreeRam = getNetworkRealFreeRam(ns, servers);
    const queueRam = getQueueRam(ns, eventQueue);
    const virtualFreeRam = realFreeRam - queueRam;

    // ----------------------------------------------------------------------
    // 💓 PERIODISCHER HEARTBEAT-LOG (alle 5 Sekunden)
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
        if (planning.target !== target) {
          if (eventQueue.length > 0) {
            logger.debug(
              `⏳ Zielwechsel steht an (${target} -> ${planning.target}), warte auf Entleerung der Queue (${eventQueue.length} Events)...`,
            );
            await ns.sleep(250);
            continue;
          }
          resetBatcherState();
          logger.info(`🚀 JIT Wechsel auf Ziel: ${planning.target}`);
        }
        target = planning.target;
        activePlan = planning.plan;
        dynamicMaxBatchesForTarget = planning.maxBatches;
        batchesSentForTarget = 0;

        const mode = activePlan?.hackThreads === 0 ? "PREP" : "HWGW";
        logger.info(
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
          batcherPlan: null,
        });
        await ns.sleep(1000);
        continue;
      }
    }

    // ----------------------------------------------------------------------
    // ⏱️ LIVE PREP-TIMER UPDATE (1x pro Sekunde)
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
    // 📥 2. EVENT-QUEUE BEFÜLLEN
    // ----------------------------------------------------------------------
    if (
      target &&
      activePlan &&
      activeBatchIds.size < dynamicMaxBatchesForTarget
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
        nextAvailableLandTime += Math.max(BATCH_GAP, SPACER * 4);

        // 🚀 PREP-TIMER FIX: Setzt das Prep-Ende dynamisch auf die Landezeit des letzten Batches
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

        patchState(ns, {
          batcherTarget: target,
          batcherProgress: progressMsg,
          batcherPlan: activePlan,
          batcherDynamicMaxBatches: dynamicMaxBatchesForTarget,
          batcherRamNeeded: activePlan.totalRam * dynamicMaxBatchesForTarget,
        });
      } else {
        // DIAGNOSE LOG: Warum schickt er gerade keine neuen Batches?
        if (now - lastRamThrottleLogTime > 4000) {
          lastRamThrottleLogTime = now;
          logger.debug(
            `⏸️ Warten auf RAM zum Queuen von b${batchIdCounter}: ` +
              `Benötigt=${activePlan.totalRam.toFixed(1)}GB | Verfügbar=${safeVirtualRam.toFixed(1)}GB (RealFree=${realFreeRam.toFixed(1)}GB, QueueRam=${queueRam.toFixed(1)}GB)`,
          );
        }

        if (eventQueue.length === 0) {
          logger.warn(
            `⚠️ RAM erschöpft für ${target} (Frei: ${virtualFreeRam.toFixed(1)}GB, Benötigt: ${activePlan.totalRam.toFixed(1)}GB). Target-Reset.`,
          );

          targetBlacklist.set(target, now + 15000);
          resetBatcherState();
          await ns.sleep(3000);
          continue;
        }
      }
    }

    // ----------------------------------------------------------------------
    // ⚡ 3. JIT DISPATCH LOOP
    // ----------------------------------------------------------------------
    while (eventQueue.length > 0 && Date.now() >= eventQueue[0].startTime) {
      const event = eventQueue.shift()!;
      const lag = Date.now() - event.startTime;
      const batchState = activeBatches.get(event.batchId);

      // LAG-PRUNE CHECK
      if (lag > 60) {
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
