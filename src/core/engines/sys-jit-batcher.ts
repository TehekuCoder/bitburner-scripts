import { NS, BitNodeMultipliers } from "@ns";
import { internalPlanner } from "/lib/utils/internal-planner.js";
import {
  getAvailableWorkers,
  executeOnWorkers,
  insertEventSorted,
  killWorkerPayloads,
  syncPayloads,
  createBatchEvents,
  cleanupActiveBatches,
} from "lib/worker-executor.js";
import { SPACER, BATCH_GAP } from "/lib/constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import {
  getAllServers,
  getNetworkRealFreeRam,
  getQueueRam,
  getNetworkMaxRam,
} from "/lib/network.js";
import { ActiveBatch, JitEvent } from "/lib/types/batcher.js";
import { patchBatcherState } from "/lib/state.js";
import { loadBnMults } from "/lib/utils";


type PlannerPlan = NonNullable<ReturnType<typeof internalPlanner>>;

interface TargetContext {
  target: string;
  plan: PlannerPlan;
  dynamicMaxBatches: number;
  batchesSent: number;
  nextAvailableLandTime: number;
  prepEndTime: number;
  activeBatchIds: Set<number>;
}

// Globaler Oberwert gegen Event-Loop Overhead bei extrem vielen laufenden Skripten
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

  // Globales Event- & Batch-Management
  const eventQueue: JitEvent[] = [];
  const activeBatches = new Map<number, ActiveBatch>();
  const activeBatchIdsSet = new Set<number>();
  const targetBlacklist = new Map<string, number>();

  // Multi-Target Map
  const activeTargets = new Map<string, TargetContext>();

  let batchIdCounter = 0;
  let lastHackingLevel = ns.getHackingLevel();
  let lastHeartbeatTime = 0;
  let lastRamThrottleLogTime = 0;
  let lastEvictionCheck = 0;
  let rollingLag = 0;

  /** Entfernt ein einzelnes Ziel isoliert aus dem Batcher ohne andere Targets zu stören */
  function removeTarget(targetName: string, reason: string): void {
    const ctx = activeTargets.get(targetName);
    if (!ctx) return;

    // 1. Events dieses Targets aus der Queue filtern
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < eventQueue.length; readIndex++) {
      if (eventQueue[readIndex].target !== targetName) {
        eventQueue[writeIndex] = eventQueue[readIndex];
        writeIndex++;
      }
    }
    eventQueue.length = writeIndex;

    // 2. Aktive Batches dieses Targets bereinigen
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

  /** Vollständiger Reset aller Targets (z. B. bei globalem Level-Up) */
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

    // ----------------------------------------------------------------------
    // 🧹 1. BATCH-ABSCHLUSS & CLEANUP
    // ----------------------------------------------------------------------
    for (const ctx of activeTargets.values()) {
      const isPrepBatch = ctx.plan.hackThreads === 0;
      cleanupActiveBatches(
        activeBatches,
        activeBatchIdsSet,
        now,
        isPrepBatch,
        logger,
      );

      // Entferne beendete Batch-IDs aus dem lokalen Set des Targets
      for (const bId of Array.from(ctx.activeBatchIds)) {
        if (!activeBatchIdsSet.has(bId)) {
          ctx.activeBatchIds.delete(bId);
        }
      }

      // 🧹 PREP-ENDE CHECK
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

    // Server-Scanning & Multiplikatoren alle 10s aktualisieren
    if (now - lastServerScan > 10000) {
      servers = getAllServers(ns);
      syncPayloads(ns, servers);
      bnMults = loadBnMults(ns);
      lastServerScan = now;
    }

    // ----------------------------------------------------------------------
    // 🛡️ 2. LEVEL-UP PRÜFUNG (GLOBALER RESET)
    // ----------------------------------------------------------------------
    const currentLevel = ns.getHackingLevel();
    const levelDelta = currentLevel - lastHackingLevel;
    const minAbsDelta = Math.max(100, Math.floor(lastHackingLevel * 0.05));

    if (levelDelta >= minAbsDelta) {
      lastHackingLevel = currentLevel;
      resetAllTargets(
        `Major Level-Up (${currentLevel - levelDelta} -> ${currentLevel})`,
      );
    }

    // ----------------------------------------------------------------------
    // 🩺 3. HEALTH-CHECK (PER TARGET)
    // ----------------------------------------------------------------------
    for (const ctx of Array.from(activeTargets.values())) {
      const isPrepping = now < ctx.prepEndTime && ctx.activeBatchIds.size > 0;
      const isHWGWActive = ctx.plan.hackThreads > 0;

      if (!isPrepping && isHWGWActive) {
        const currentSec = ns.getServerSecurityLevel(ctx.target);
        const minSec = ns.getServerMinSecurityLevel(ctx.target);
        const secDiff = currentSec - minSec;

        if (secDiff > 0.5) {
          targetBlacklist.set(ctx.target, now + 45000);
          removeTarget(
            ctx.target,
            `Desynchronisation (+${secDiff.toFixed(2)} Sec)`,
          );
        }
      }
    }

    // Expiry-Check für Blacklist
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

    // ----------------------------------------------------------------------
    // 💓 HEARTBEAT-LOG
    // ----------------------------------------------------------------------
    if (now - lastHeartbeatTime > 10000) {
      lastHeartbeatTime = now;
      const targetNames =
        Array.from(activeTargets.keys()).join(", ") || "Keine";
      logger.debug(
        `💓 Ziele: [${targetNames}] | Queue: ${eventQueue.length} (${queueRam.toFixed(
          0,
        )}GB) | Lag: ${rollingLag.toFixed(1)}ms | Freier RAM: ${virtualFreeRam.toFixed(
          0,
        )}GB`,
      );
    }

    // ----------------------------------------------------------------------
    // 🔄 4. TARGET EVICTION CHECK (ALLE 20 SECONDS)
    // ----------------------------------------------------------------------
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
      );
      lastEvictionCheck = now;
    }

    // ----------------------------------------------------------------------
    // ⚖️ 5. DYNAMISCHE RAM-VERTEILUNG (CAPS NEU BERECHNEN)
    // ----------------------------------------------------------------------
    updateDynamicBatchCaps(
      activeTargets,
      virtualFreeRam,
      MAX_SAFE_CONCURRENT_SCRIPTS,
    );

    // ----------------------------------------------------------------------
    // 🔍 6. MULTI-TARGET PLANNER EVALUIERUNG
    // ----------------------------------------------------------------------
    if (activeTargets.size < dynamicMaxTargets && virtualFreeRam > 10) {
      const candidateServers = servers.filter(
        (s) => !targetBlacklist.has(s) && !activeTargets.has(s),
      );

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

    // ----------------------------------------------------------------------
    // 📥 7. EVENT-QUEUE BEFÜLLEN (FÜR ALLE TARGETS)
    // ----------------------------------------------------------------------
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
              `⏸️ RAM-Engpass für ${ctx.target}. Benötigt: ${planRam.toFixed(
                1,
              )}GB | Frei: ${safeVirtualRam.toFixed(1)}GB`,
              ctx.target,
            );
          }
          break; // Weiter zum nächsten Target
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

    // ----------------------------------------------------------------------
    // ⚡ 8. JIT DISPATCH LOOP (GLOBAL)
    // ----------------------------------------------------------------------
    if (eventQueue.length > 0 && Date.now() >= eventQueue[0].startTime) {
      const workers = getAvailableWorkers(ns, servers);

      while (eventQueue.length > 0 && Date.now() >= eventQueue[0].startTime) {
        const event = eventQueue.shift()!;
        const lag = Date.now() - event.startTime;
        const batchState = activeBatches.get(event.batchId);

        // Rolling Average für geglättetes Lag-Monitoring
        rollingLag = rollingLag * 0.9 + lag * 0.1;

        if (lag > 150) {
          logger.warn(
            `⏳ Lag (${lag}ms) bei Batch b${event.batchId} [${event.target}].`,
            event.target,
          );
          if (batchState && batchState.executedEventsCount > 0) {
            targetBlacklist.set(event.target, now + 5000);
            removeTarget(event.target, "Event verworfen wegen Lag");
            break;
          } else {
            // Unausgeführtes Event aus Queue entfernen
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
          logger.error(
            `🛑 Ausführungsfehler auf Workers für ${event.target}. Target isoliert pausiert.`,
            event.target,
          );
          targetBlacklist.set(event.target, now + 45000);
          removeTarget(event.target, "Worker Exec Error");
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

// ==========================================================================
// 🛠️ HELPER FUNCTIONS (LOCAL TO BATCHER)
// ==========================================================================

/** Verteilt den freien RAM proportional zum greedScore aller aktiven Targets */
function updateDynamicBatchCaps(
  activeTargets: Map<string, TargetContext>,
  totalFreeRam: number,
  maxConcurrentScripts: number,
): void {
  if (activeTargets.size === 0) return;

  let totalScore = 0;
  for (const ctx of activeTargets.values()) {
    totalScore += Math.max(0.001, ctx.plan.greedScore);
  }

  const activeTargetCount = activeTargets.size;
  const scriptBudgetPerTarget = Math.floor(
    maxConcurrentScripts / Math.max(1, activeTargetCount),
  );

  for (const ctx of activeTargets.values()) {
    const scoreShare = ctx.plan.greedScore / totalScore;
    const targetRamBudget = totalFreeRam * scoreShare;

    if (ctx.plan.batchRam > 0) {
      const maxRamBatches = Math.floor(targetRamBudget / ctx.plan.batchRam);
      const maxPipeBatches = Math.max(
        1,
        Math.floor(ctx.plan.weakenTime / BATCH_GAP),
      );
      const safeScriptBatches = Math.floor(scriptBudgetPerTarget / 4);

      ctx.dynamicMaxBatches = Math.max(
        1,
        Math.min(maxPipeBatches, maxRamBatches, safeScriptBatches),
      );
    }
  }
}

/** Ersetzt das schlechteste Target, wenn ein deutlich besseres gefunden wird */
function checkTargetEviction(
  ns: NS,
  activeTargets: Map<string, TargetContext>,
  candidateServers: string[],
  virtualFreeRam: number,
  bnMults: BitNodeMultipliers,
  logger: Logger,
  removeTargetFn: (target: string, reason: string) => void,
): void {
  if (activeTargets.size === 0) return;

  let worstTarget: TargetContext | null = null;
  let lowestScore = Infinity;

  for (const ctx of activeTargets.values()) {
    if (ctx.plan.hackThreads > 0 && ctx.plan.greedScore < lowestScore) {
      lowestScore = ctx.plan.greedScore;
      worstTarget = ctx;
    }
  }

  if (!worstTarget) return;

  const bestCandidatePlan = internalPlanner(
    ns,
    candidateServers,
    getNetworkMaxRam(ns, candidateServers),
    virtualFreeRam,
    bnMults,
    ns.getPlayer(),
    logger,
  );

  if (bestCandidatePlan && bestCandidatePlan.greedScore > lowestScore * 1.3) {
    logger.info(
      `🔄 Target-Eviction: Ersetze [${worstTarget.target}] (Score: ${lowestScore.toFixed(
        0,
      )}) durch [${bestCandidatePlan.target}] (Score: ${bestCandidatePlan.greedScore.toFixed(
        0,
      )})`,
    );
    removeTargetFn(worstTarget.target, "Evicted: Höherwertiges Ziel gefunden");
  }
}

/** Berechnet die maximal simultanen Ziele basierend auf Netzwerk-RAM und Level */
function getDynamicMaxTargets(
  totalMaxRam: number,
  playerHacking: number,
): number {
  if (totalMaxRam < 1024) return 1; // < 1 TB RAM
  if (totalMaxRam < 8192) return 2; // < 8 TB RAM
  if (totalMaxRam < 65536) return 4; // < 65 TB RAM
  if (totalMaxRam < 1048576) return 8; // < 1 PB RAM

  return Math.min(24, 8 + Math.floor(playerHacking / 1000));
}

/** Dynamische Gap-Anpassung zur Vermeidung von Event-Loop Lag */
function getAdaptiveBatchGap(currentRollingLag: number): number {
  if (currentRollingLag > 80) return BATCH_GAP * 2.5; // Starke Entlastung
  if (currentRollingLag > 40) return BATCH_GAP * 1.5; // Leichte Entlastung
  if (currentRollingLag < 8) return Math.max(5, BATCH_GAP * 0.8); // Maximaler Durchsatz
  return BATCH_GAP;
}


