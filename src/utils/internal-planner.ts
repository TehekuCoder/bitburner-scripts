import { NS, BitNodeMultipliers, Player, Server } from "@ns";
import { BATCH_GAP } from "/lib/constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";

export interface BatchPlan {
  target: string;
  mode: "PREP" | "HWGW";
  hackThreads: number;
  weaken1Threads: number;
  growThreads: number;
  weaken2Threads: number;
  hackTime: number;
  weakenTime: number;
  growTime: number;
  greed: number;
  greedScore: number;
  maxBatches: number;
  batchRam: number;
}

const MAX_SAFE_CONCURRENT_SCRIPTS = 4000; // Max scripts in pipeline

const RAM_HACK = 1.7;
const RAM_GROW = 1.75;
const RAM_WEAKEN = 1.75;

function getMinimumWeakenTime(player: Player): number {
  if (player.skills.hacking >= 10_000) return 0;
  if (player.skills.hacking >= 5_000) return 400;
  return 1200;
}

/**
 * Berechnet das dynamische Batch-Limit basierend auf Pipeline-Zeit,
 * RAM und JS-Event-Loop-Sicherheit.
 */
function getDynamicBatchCap(
  weakenTime: number,
  batchGap: number,
  virtualFreeRam: number,
  batchRam: number,
  maxConcurrentScripts = MAX_SAFE_CONCURRENT_SCRIPTS,
): number {
  if (batchRam <= 0) return 0;

  const maxPipeBatches = Math.max(1, Math.floor(weakenTime / batchGap));
  const safeFreeRam = Math.max(0, virtualFreeRam);
  const maxRamBatches = Math.floor(safeFreeRam / batchRam);
  const safeScriptBatches = Math.floor(maxConcurrentScripts / 4);

  return Math.max(
    0,
    Math.min(maxPipeBatches, maxRamBatches, safeScriptBatches),
  );
}

export function internalPlanner(
  ns: NS,
  servers: string[],
  maxRam: number,
  virtualFreeRam: number,
  bnMults: BitNodeMultipliers,
  player: Player = ns.getPlayer(),
  customLogger?: Logger,
): BatchPlan | null {
  const logger = customLogger ?? new Logger(ns, "PLANNER");
  let bestPlan: BatchPlan | null = null;
  let highestScore = -1;

  for (const target of servers) {
    if (!ns.hasRootAccess(target)) continue;

    const serverObj = ns.getServer(target);
    if (!serverObj.moneyMax || serverObj.moneyMax <= 0) continue;
    if ((serverObj.requiredHackingSkill ?? Infinity) > player.skills.hacking)
      continue;

    const moneyMax = serverObj.moneyMax;
    const moneyAvailable = serverObj.moneyAvailable ?? 0;
    const minSec = serverObj.minDifficulty ?? 1;
    const currentSec = serverObj.hackDifficulty ?? minSec;

    const preppedServer: Server = {
      ...serverObj,
      hackDifficulty: minSec,
      moneyAvailable: moneyMax,
    };

    const weakenTime = ns.formulas?.hacking
      ? ns.formulas.hacking.weakenTime(preppedServer, player)
      : ns.getWeakenTime(target);

    const minWeakenTime = getMinimumWeakenTime(player);
    if (weakenTime < minWeakenTime) continue;

    const growTime = ns.formulas?.hacking
      ? ns.formulas.hacking.growTime(preppedServer, player)
      : ns.getGrowTime(target);

    const hackTime = ns.formulas?.hacking
      ? ns.formulas.hacking.hackTime(preppedServer, player)
      : ns.getHackTime(target);

    const isPrepped =
      currentSec <= minSec + 0.5 && moneyAvailable >= moneyMax * 0.99;

    // -----------------------------------------------------------------------
    // PHASE 1: Target benötigt PREP
    // -----------------------------------------------------------------------
    if (!isPrepped) {
      let weakenPrepThreads = 0;
      let growPrepThreads = 0;
      let prepWeaken2Threads = 0;

      if (currentSec > minSec + 0.5) {
        const secDiff = currentSec - minSec;
        weakenPrepThreads = Math.max(1, Math.ceil(secDiff / 0.05));
      }

      if (moneyAvailable < moneyMax * 0.99) {
        const growthFactor = moneyMax / Math.max(1, moneyAvailable);
        const growthServer: Server = {
          ...serverObj,
          hackDifficulty: minSec,
          moneyAvailable: Math.max(1, moneyAvailable),
        };

        const rawGrowThreads = ns.formulas?.hacking
          ? ns.formulas.hacking.growThreads(growthServer, player, moneyMax)
          : ns.growthAnalyze(target, growthFactor);

        growPrepThreads = Math.max(
          1,
          Math.ceil(rawGrowThreads || growthFactor),
        );
        prepWeaken2Threads = Math.ceil((growPrepThreads * 0.004) / 0.05);
      }

      let prepRam =
        (weakenPrepThreads + prepWeaken2Threads) * RAM_WEAKEN +
        growPrepThreads * RAM_GROW;

      const safeVirtualFreeRam = Math.max(0, virtualFreeRam);
      const maxUsablePrepRam = Math.max(RAM_WEAKEN, safeVirtualFreeRam * 0.98);

      if (prepRam > maxUsablePrepRam && maxUsablePrepRam >= RAM_WEAKEN) {
        const scale = maxUsablePrepRam / prepRam;
        if (weakenPrepThreads > 0) {
          weakenPrepThreads = Math.max(
            1,
            Math.floor(weakenPrepThreads * scale),
          );
        }
        if (growPrepThreads > 0) {
          growPrepThreads = Math.floor(growPrepThreads * scale);
          prepWeaken2Threads =
            growPrepThreads > 0
              ? Math.ceil((growPrepThreads * 0.004) / 0.05)
              : 0;
        }

        prepRam =
          (weakenPrepThreads + prepWeaken2Threads) * RAM_WEAKEN +
          growPrepThreads * RAM_GROW;
      }

      if (
        !Number.isFinite(prepRam) ||
        prepRam <= 0 ||
        prepRam > maxUsablePrepRam
      )
        continue;

      const prepScore = (moneyMax / Math.max(weakenTime, 1000)) * 0.001;
      if (prepScore > highestScore) {
        highestScore = prepScore;
        bestPlan = {
          target,
          mode: "PREP",
          hackThreads: 0,
          weaken1Threads: weakenPrepThreads,
          growThreads: growPrepThreads,
          weaken2Threads: prepWeaken2Threads,
          hackTime,
          weakenTime,
          growTime,
          greed: 0,
          greedScore: prepScore,
          maxBatches: 1,
          batchRam: prepRam,
        };
      }
      continue;
    }

    // -----------------------------------------------------------------------
    // PHASE 2: Target ist prepped -> HWGW Greed Search
    // -----------------------------------------------------------------------
    let bestGreedScore = -1;
    let optimalTargetPlan: BatchPlan | null = null;

    const evaluateGreed = (
      greed: number,
    ): { p: BatchPlan; greedScore: number } | null => {
      const hackChance = ns.formulas?.hacking
        ? ns.formulas.hacking.hackPercent(preppedServer, player)
        : ns.hackAnalyze(target);

      if (hackChance <= 0) return null;

      const hackThreads = Math.max(1, Math.floor(greed / hackChance));
      const actualGreed = hackThreads * hackChance;

      if (actualGreed >= 0.98) return null;

      const weaken1Threads = Math.ceil((hackThreads * 0.002) / 0.05);

      const postHackMoney = Math.max(1, moneyMax * (1 - actualGreed));
      const growthFactor = moneyMax / postHackMoney;

      const serverAfterHack: Server = {
        ...preppedServer,
        moneyAvailable: postHackMoney,
      };

      const growThreads = ns.formulas?.hacking
        ? Math.ceil(
            ns.formulas.hacking.growThreads(serverAfterHack, player, moneyMax),
          ) + 1
        : Math.ceil(ns.growthAnalyze(target, growthFactor)) + 1;

      const weaken2Threads = Math.ceil((growThreads * 0.004) / 0.05);

      const batchRam =
        hackThreads * RAM_HACK +
        weaken1Threads * RAM_WEAKEN +
        growThreads * RAM_GROW +
        weaken2Threads * RAM_WEAKEN;

      if (!Number.isFinite(batchRam) || batchRam > maxRam) return null;

      const activeConcurrentBatches = getDynamicBatchCap(
        weakenTime,
        BATCH_GAP,
        virtualFreeRam,
        batchRam,
        MAX_SAFE_CONCURRENT_SCRIPTS,
      );

      if (activeConcurrentBatches <= 0) return null;

      const profitPerBatch = moneyMax * actualGreed;
      const greedScore =
        (profitPerBatch * activeConcurrentBatches) / Math.max(1000, weakenTime);

      return {
        p: {
          target,
          mode: "HWGW",
          hackThreads,
          weaken1Threads,
          growThreads,
          weaken2Threads,
          hackTime,
          weakenTime,
          growTime,
          greed: actualGreed,
          greedScore,
          maxBatches: activeConcurrentBatches,
          batchRam,
        },
        greedScore,
      };
    };

    const greedSteps = [
      0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95,
    ];
    let bestCoarseGreed = 0.01;

    for (const greed of greedSteps) {
      const res = evaluateGreed(greed);
      if (res && res.greedScore > bestGreedScore) {
        bestGreedScore = res.greedScore;
        optimalTargetPlan = res.p;
        bestCoarseGreed = greed;
      }
    }

    if (optimalTargetPlan) {
      const fineStep = 0.005;
      const fineMin = Math.max(0.001, bestCoarseGreed - 0.04);
      const fineMax = Math.min(0.97, bestCoarseGreed + 0.04);

      for (let greed = fineMin; greed <= fineMax; greed += fineStep) {
        const res = evaluateGreed(greed);
        if (res && res.greedScore > bestGreedScore) {
          bestGreedScore = res.greedScore;
          optimalTargetPlan = res.p;
        }
      }
    }

    if (optimalTargetPlan && bestGreedScore > highestScore) {
      highestScore = bestGreedScore;
      bestPlan = optimalTargetPlan;
    }
  }

  if (bestPlan) {
    logger.debug(
      `📊 Optimum berechnet: ${bestPlan.target} [${bestPlan.mode}] | Greed: ${(bestPlan.greed * 100).toFixed(1)}% | Score: ${bestPlan.greedScore.toFixed(0)}`,
      bestPlan.target,
      { context: { mode: bestPlan.mode, maxBatches: bestPlan.maxBatches } },
    );
  } else {
    logger.debug(
      "⚠️ Planner fand kein valides Ziel für die aktuellen Netzwerk-Ressourcen.",
    );
  }

  return bestPlan;
}