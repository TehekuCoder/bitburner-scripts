import { NS, BitNodeMultipliers } from "@ns";
import {
  SPACER,
  BATCH_GAP,
  PATH_HACK,
  PATH_GROW,
  PATH_WEAKEN,
} from "../infrastructure/runtime/batcher.js";
import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";
import { JitEvent, ActiveBatch, TargetContext, BatchPlan } from "/shared/types/batcher.js";
import { internalPlanner } from "/lib/utils/internal-planner.js";

/** Berechnet die nutzbaren Threads für eine freie RAM-Menge (mit Epsilon-Toleranz) */
export function getUsableThreads(freeRam: number, scriptRam: number): number {
  if (
    !Number.isFinite(freeRam) ||
    !Number.isFinite(scriptRam) ||
    scriptRam <= 0
  ) {
    return 0;
  }
  return Math.floor((freeRam + 1e-5) / scriptRam);
}

/** Erstellt die Liste der JIT-Events für einen einzelnen Batch */
export function createBatchEvents(
  bId: number,
  target: string,
  tLand: number,
  plan: BatchPlan,
): JitEvent[] {
  const prefix = `${target}-b${bId}`;
  return [
    {
      id: `${prefix}-h`,
      batchId: bId,
      script: PATH_HACK,
      threads: plan.hackThreads,
      target,
      startTime: tLand - SPACER - plan.hackTime,
      landTime: tLand - SPACER,
    },
    {
      id: `${prefix}-w1`,
      batchId: bId,
      script: PATH_WEAKEN,
      threads: plan.weaken1Threads,
      target,
      startTime: tLand - plan.weakenTime,
      landTime: tLand,
    },
    {
      id: `${prefix}-g`,
      batchId: bId,
      script: PATH_GROW,
      threads: plan.growThreads,
      target,
      startTime: tLand + SPACER - plan.growTime,
      landTime: tLand + SPACER,
    },
    {
      id: `${prefix}-w2`,
      batchId: bId,
      script: PATH_WEAKEN,
      threads: plan.weaken2Threads,
      target,
      startTime: tLand + 2 * SPACER - plan.weakenTime,
      landTime: tLand + 2 * SPACER,
    },
  ].filter((ev) => ev.threads > 0);
}

/** Verteilt den freien RAM proportional zum greedScore aller aktiven Targets */
export function updateDynamicBatchCaps(
  activeTargets: Map<string, TargetContext>,
  totalFreeRam: number,
  maxConcurrentScripts: number,
  adaptiveGap: number = BATCH_GAP,
): void {
  if (activeTargets.size === 0) return;

  let totalScore = 0;
  for (const ctx of activeTargets.values()) {
    totalScore += Math.max(0.001, ctx.plan.greedScore ?? ctx.plan.greed ?? 1);
  }

  const scriptBudgetPerTarget = Math.floor(
    maxConcurrentScripts / Math.max(1, activeTargets.size),
  );

  const effectiveGap = Math.max(BATCH_GAP, adaptiveGap);

  for (const ctx of activeTargets.values()) {
    const score = ctx.plan.greedScore ?? ctx.plan.greed ?? 1;
    const scoreShare = score / totalScore;
    const targetRamBudget = totalFreeRam * scoreShare;

    if (ctx.plan.batchRam > 0) {
      const maxRamBatches = Math.floor(targetRamBudget / ctx.plan.batchRam);
      const maxPipeBatches = Math.max(
        1,
        Math.floor(ctx.plan.weakenTime / effectiveGap),
      );
      const safeScriptBatches = Math.floor(scriptBudgetPerTarget / 4);

      ctx.dynamicMaxBatches = Math.max(
        1,
        Math.min(maxPipeBatches, maxRamBatches, safeScriptBatches),
      );
    }
  }
}

/** Sortiertes Einfügen via Binärsuche O(log N) */
export function insertEventSorted(queue: JitEvent[], event: JitEvent): void {
  let low = 0;
  let high = queue.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (queue[mid].startTime < event.startTime) low = mid + 1;
    else high = mid;
  }
  queue.splice(low, 0, event);
}

/** In-place Queue-Bereinigung ohne Garbage Collection Overhead */
export function pruneBatchFromQueue(queue: JitEvent[], batchId: number): void {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < queue.length; readIndex++) {
    if (queue[readIndex].batchId !== batchId) {
      queue[writeIndex] = queue[readIndex];
      writeIndex++;
    }
  }
  queue.length = writeIndex;
}

/** Überprüft aktive Batches auf Abschluss oder Hängenbleiben und räumt sie auf */
export function cleanupActiveBatches(
  activeBatches: Map<number, ActiveBatch>,
  activeBatchIds: Set<number>,
  now: number,
  isPrepBatch: boolean,
  logger: Logger,
): void {
  for (const [bId, bData] of activeBatches.entries()) {
    if (now >= bData.landEndTime) {
      const fullyExecuted = bData.executedEventsCount >= bData.totalEventsCount;

      if (fullyExecuted) {
        activeBatches.delete(bId);
        activeBatchIds.delete(bId);
      } else if (now > bData.landEndTime + 3000) {
        activeBatches.delete(bId);
        activeBatchIds.delete(bId);
        logger.warn(
          `🧹 Watchdog: Batch b${bId} unvollständig (${bData.executedEventsCount}/${bData.totalEventsCount} Events) zwangsaufgeräumt.`,
        );
      }
    }
  }
}

/** Ersetzt das schlechteste Target, wenn ein deutlich besseres gefunden wird */
export function checkTargetEviction(
  ns: NS,
  activeTargets: Map<string, TargetContext>,
  candidateServers: string[],
  virtualFreeRam: number,
  bnMults: BitNodeMultipliers,
  logger: Logger,
  removeTargetFn: (target: string, reason: string) => void,
  totalNetworkMaxRam: number,
): void {
  if (activeTargets.size === 0) return;

  let worstTarget: TargetContext | null = null;
  let lowestScore = Infinity;

  for (const ctx of activeTargets.values()) {
    const score = ctx.plan.greedScore ?? ctx.plan.greed ?? 0;
    if (ctx.plan.hackThreads > 0 && score < lowestScore) {
      lowestScore = score;
      worstTarget = ctx;
    }
  }

  if (!worstTarget) return;

  const bestCandidatePlan = internalPlanner(
    ns,
    candidateServers,
    totalNetworkMaxRam,
    virtualFreeRam,
    bnMults,
    ns.getPlayer(),
    logger,
  );

  const candidateScore = bestCandidatePlan?.greedScore ?? bestCandidatePlan?.greed ?? 0;

  if (bestCandidatePlan && candidateScore > lowestScore * 1.3) {
    logger.info(
      `🔄 Target-Eviction: Ersetze [${worstTarget.target}] (Score: ${lowestScore.toFixed(0)}) durch [${bestCandidatePlan.target}] (Score: ${candidateScore.toFixed(0)})`,
    );
    removeTargetFn(worstTarget.target, "Evicted: Höherwertiges Ziel gefunden");
  }
}

/** Berechnet die maximal simultanen Ziele basierend auf Netzwerk-RAM und Level */
export function getDynamicMaxTargets(
  totalMaxRam: number,
  playerHacking: number,
): number {
  if (totalMaxRam < 1024) return 1;
  if (totalMaxRam < 8192) return 2;
  if (totalMaxRam < 65536) return 4;
  if (totalMaxRam < 1048576) return 8;

  return Math.min(24, 8 + Math.floor(playerHacking / 1000));
}

/** Dynamische Gap-Anpassung zur Vermeidung von Event-Loop Lag */
export function getAdaptiveBatchGap(currentRollingLag: number): number {
  if (currentRollingLag > 80) return BATCH_GAP * 2.5;
  if (currentRollingLag > 40) return BATCH_GAP * 1.5;
  if (currentRollingLag < 8) return Math.max(5, BATCH_GAP * 0.8);
  return BATCH_GAP;
}