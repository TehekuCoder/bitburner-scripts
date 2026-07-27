import { NS, BitNodeMultipliers, Player, Server } from "@ns";
import { BATCH_GAP } from "/lib/constants";

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

const RAM_HACK = 1.7;
const RAM_GROW = 1.75;
const RAM_WEAKEN = 1.75;
const MAX_BATCH_CAP = 150;

function getMinimumWeakenTime(player: Player): number {
  if (player.skills.hacking >= 10_000) return 0;
  if (player.skills.hacking >= 5_000) return 400;
  return 1200;
}

function createFallbackPlan(
  ns: NS,
  target: string,
  serverObj: Server,
  player: Player,
  weakenTime: number,
  growTime: number,
  hackTime: number,
): BatchPlan {
  const moneyMax = serverObj.moneyMax ?? 0;
  const moneyAvailable = serverObj.moneyAvailable ?? 0;
  const minSec = serverObj.minDifficulty ?? 1;
  const currentSec = serverObj.hackDifficulty ?? minSec;
  const isPrepped =
    currentSec <= minSec + 0.5 && moneyAvailable >= moneyMax * 0.99;

  if (!isPrepped) {
    const weakenThreads = Math.max(1, Math.ceil(Math.max(1, currentSec - minSec) / 0.05));
    return {
      target,
      mode: "PREP",
      hackThreads: 0,
      weaken1Threads: weakenThreads,
      growThreads: 0,
      weaken2Threads: 0,
      hackTime,
      weakenTime,
      growTime,
      greed: 0,
      greedScore: (moneyMax / Math.max(weakenTime, 3000)) * 0.1,
      maxBatches: 1,
      batchRam: weakenThreads * RAM_WEAKEN,
    };
  }

  const hackChance = ns.formulas?.hacking
    ? ns.formulas.hacking.hackPercent(
        {
          ...serverObj,
          hackDifficulty: minSec,
          moneyAvailable: moneyMax,
        },
        player,
      )
    : ns.hackAnalyze(target);

  const safeHackChance = Math.max(0.001, Math.min(hackChance, 0.2));
  const hackThreads = Math.max(1, Math.floor(0.02 / safeHackChance));
  const weaken1Threads = Math.max(1, Math.ceil((hackThreads * 0.002) / 0.05));
  const growThreads = 1;
  const weaken2Threads = Math.max(1, Math.ceil((growThreads * 0.004) / 0.05));
  const batchRam =
    hackThreads * RAM_HACK +
    weaken1Threads * RAM_WEAKEN +
    growThreads * RAM_GROW +
    weaken2Threads * RAM_WEAKEN;

  return {
    target,
    mode: "HWGW",
    hackThreads,
    weaken1Threads,
    growThreads,
    weaken2Threads,
    hackTime,
    weakenTime,
    growTime,
    greed: Math.min(0.2, hackThreads * safeHackChance),
    greedScore: (moneyMax * Math.min(0.2, hackThreads * safeHackChance)) / Math.max(weakenTime, 3000),
    maxBatches: 1,
    batchRam,
  };
}

export function internalPlanner(
  ns: NS,
  servers: string[],
  maxRam: number,
  virtualFreeRam: number,
  bnMults: BitNodeMultipliers,
  player: Player = ns.getPlayer(),
): BatchPlan | null {
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

    // 🛑 FIX 1: Ignoriere Server nur dann, wenn ihre Weaken-Zeit wirklich zu klein ist.
    // Bei sehr hohen Hacklevels sind 1.2s zu streng und führen zu unnötigen Ausfällen.
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

      const needsWeaken = currentSec > minSec + 0.5;
      const needsGrowth = moneyAvailable < moneyMax * 0.99;

      if (needsWeaken) {
        const secDiff = currentSec - minSec;
        weakenPrepThreads = Math.max(1, Math.ceil(secDiff / 0.05));
      }

      if (needsGrowth) {
        const growthFactor = moneyMax / Math.max(1, moneyAvailable);
        const growthServer: Server = {
          ...serverObj,
          hackDifficulty: minSec,
          moneyAvailable: moneyAvailable,
        };

        const rawGrowThreads = ns.formulas?.hacking
          ? ns.formulas.hacking.growThreads(growthServer, player, moneyMax)
          : ns.growthAnalyze(target, growthFactor);

        if (Number.isFinite(rawGrowThreads) && rawGrowThreads > 0) {
          growPrepThreads = Math.max(1, Math.ceil(rawGrowThreads));
        } else {
          growPrepThreads = Math.max(1, Math.ceil(growthFactor));
        }

        prepWeaken2Threads = Math.ceil((growPrepThreads * 0.004) / 0.05);
      }

      let prepRam =
        (weakenPrepThreads + prepWeaken2Threads) * RAM_WEAKEN +
        growPrepThreads * RAM_GROW;

      const safeMaxRam = Math.max(0, Math.min(maxRam, 1_000_000_000));
      const safeVirtualFreeRam = Math.max(0, Math.min(virtualFreeRam, safeMaxRam));
      const maxUsablePrepRam = Math.max(
        RAM_WEAKEN,
        safeVirtualFreeRam * 0.98,
      );

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

      const prepScore = (moneyMax / weakenTime) * 0.1;
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

      // 🛑 FIX 2: Wenn 1 Thread bereits >= 80% stiehlt, ist HWGW unmöglich.
      if (hackChance <= 0 || hackChance >= 0.8) return null;

      const hackThreads = Math.max(1, Math.floor(greed / hackChance));
      const actualGreed = hackThreads * hackChance;
      if (actualGreed >= 0.95) return null;

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
          )
        : Math.ceil(ns.growthAnalyze(target, growthFactor));

      const weaken2Threads = Math.ceil((growThreads * 0.004) / 0.05);

      const batchRam =
        hackThreads * RAM_HACK +
        weaken1Threads * RAM_WEAKEN +
        growThreads * RAM_GROW +
        weaken2Threads * RAM_WEAKEN;

      const safeMaxRam = Math.max(0, Math.min(maxRam, 1_000_000_000));
      const safeVirtualFreeRam = Math.max(0, Math.min(virtualFreeRam, safeMaxRam));

      if (!Number.isFinite(batchRam) || batchRam > safeMaxRam * 1.05) return null;

      const calcMaxBatches = Math.min(
        MAX_BATCH_CAP,
        Math.max(1, Math.floor(safeVirtualFreeRam / batchRam)),
      );
      if (calcMaxBatches < 1) return null;

      // Profit pro Batch basiert auf dem tatsächlichen Anteil, den wir abziehen,
      // ohne den Hack-Chance-Faktor doppelt zu gewichten.
      const profitPerBatch = moneyMax * actualGreed;

      // Weaken-Zeit auf einen Mindestwert normieren, damit die Auswertung
      // nicht zu sehr auf super-schnelle Low-Level-Ziele ausfällt.
      const effectiveWeakenTime = Math.max(weakenTime, 3000);
      const greedScore =
        (profitPerBatch / effectiveWeakenTime) * Math.min(calcMaxBatches, 50);
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
          maxBatches: calcMaxBatches,
          batchRam,
        },
        greedScore,
      };
    };

    const greedSteps = [
      0.01, 0.02, 0.03, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7,
      0.8, 0.9,
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
      const fineMax = Math.min(0.95, bestCoarseGreed + 0.04);

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
    return bestPlan;
  }

  for (const target of servers) {
    if (!ns.hasRootAccess(target)) continue;

    const serverObj = ns.getServer(target);
    if (!serverObj.moneyMax || serverObj.moneyMax <= 0) continue;
    if ((serverObj.requiredHackingSkill ?? Infinity) > player.skills.hacking)
      continue;

    const moneyMax = serverObj.moneyMax;
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
    const growTime = ns.formulas?.hacking
      ? ns.formulas.hacking.growTime(preppedServer, player)
      : ns.getGrowTime(target);
    const hackTime = ns.formulas?.hacking
      ? ns.formulas.hacking.hackTime(preppedServer, player)
      : ns.getHackTime(target);

    if (weakenTime < getMinimumWeakenTime(player)) continue;

    return createFallbackPlan(
      ns,
      target,
      serverObj,
      player,
      weakenTime,
      growTime,
      hackTime,
    );
  }

  return null;
}
