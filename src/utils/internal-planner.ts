import { NS, BitNodeMultipliers, Player, Server } from "@ns";

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

const RAM_HACK = 1.70;
const RAM_GROW = 1.75;
const RAM_WEAKEN = 1.75;

/** Maximale Obergrenze für simulierte Batches, um Event-Loop Stalls zu vermeiden */
const MAX_BATCH_CAP = 100;

/**
 * Evaluiert alle erreichbaren Server und berechnet den profitabelsten
 * Zielserver inklusive eines optimierten HWGW- oder Prep-Batch-Plans.
 */
export function internalPlanner(
  ns: NS,
  servers: string[],
  maxRam: number,
  virtualFreeRam: number,
  bnMults: BitNodeMultipliers,
  player: Player = ns.getPlayer()
): BatchPlan | null {
  let bestPlan: BatchPlan | null = null;
  let highestScore = -1;

  for (const target of servers) {
    if (!ns.hasRootAccess(target)) continue;

    const serverObj = ns.getServer(target);
    if (!serverObj.moneyMax || serverObj.moneyMax <= 0) continue;
    if ((serverObj.requiredHackingSkill ?? Infinity) > player.skills.hacking) continue;

    const moneyMax = serverObj.moneyMax;
    const moneyAvailable = serverObj.moneyAvailable ?? 0;
    const minSec = serverObj.minDifficulty ?? 1;
    const currentSec = serverObj.hackDifficulty ?? minSec;

    // Virtualisierter prepped Server für die HWGW-Berechnung
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

    // -----------------------------------------------------------------------
    // PHASE 1: Target benötigt Vorbereitung (PREP)
    // -----------------------------------------------------------------------
    const isPrepped = currentSec <= minSec + 0.5 && moneyAvailable >= moneyMax * 0.99;

    if (!isPrepped) {
      const secDiff = Math.max(0, currentSec - minSec);
      let weakenPrepThreads = Math.ceil(secDiff / 0.05);

      let growPrepThreads = 0;
      if (moneyAvailable < moneyMax) {
        const growthFactor = moneyMax / Math.max(1, moneyAvailable);

        const prepServerObj: Server = {
          ...serverObj,
          hackDifficulty: minSec,
          moneyAvailable: Math.max(1, moneyAvailable),
        };

        growPrepThreads = ns.formulas?.hacking
          ? Math.ceil(ns.formulas.hacking.growThreads(prepServerObj, player, moneyMax))
          : Math.ceil(ns.growthAnalyze(target, growthFactor));
      }

      let prepWeaken2Threads = Math.ceil((growPrepThreads * 0.004) / 0.05);
      let prepRam =
        (weakenPrepThreads + prepWeaken2Threads) * RAM_WEAKEN +
        growPrepThreads * RAM_GROW;

      // ⚡ FIX: Skaliere PREP-Threads herunter, falls der RAM-Bedarf das freie RAM übersteigt (Partielles Prep)
      const maxUsablePrepRam = Math.min(maxRam, virtualFreeRam) * 0.90;

      if (prepRam > maxUsablePrepRam && maxUsablePrepRam > RAM_WEAKEN) {
        const scale = maxUsablePrepRam / prepRam;
        weakenPrepThreads = Math.floor(weakenPrepThreads * scale);
        growPrepThreads = Math.floor(growPrepThreads * scale);
        prepWeaken2Threads = Math.floor(prepWeaken2Threads * scale);

        // Sicherstellen, dass mindestens 1 Thread läuft, wenn RAM vorhanden ist
        if (weakenPrepThreads === 0 && secDiff > 0 && maxUsablePrepRam >= RAM_WEAKEN) {
          weakenPrepThreads = 1;
        }
        if (growPrepThreads === 0 && moneyAvailable < moneyMax && maxUsablePrepRam >= RAM_GROW) {
          growPrepThreads = 1;
        }

        prepRam =
          (weakenPrepThreads + prepWeaken2Threads) * RAM_WEAKEN +
          growPrepThreads * RAM_GROW;
      }

      // Guardrail gegen ungültigen RAM-Bedarf
      if (!Number.isFinite(prepRam) || prepRam <= 0 || prepRam > maxUsablePrepRam) continue;

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

    const evaluateGreed = (greed: number): { p: BatchPlan; greedScore: number } | null => {
      const hackPercent = ns.formulas?.hacking
        ? ns.formulas.hacking.hackPercent(preppedServer, player)
        : ns.hackAnalyze(target);

      if (hackPercent <= 0) return null;

      const hackThreads = Math.max(1, Math.floor(greed / hackPercent));
      const actualGreed = hackThreads * hackPercent;
      if (actualGreed >= 1) return null;

      const weaken1Threads = Math.ceil((hackThreads * 0.002) / 0.05);

      const postHackMoney = Math.max(1, moneyMax * (1 - actualGreed));
      const growthFactor = moneyMax / postHackMoney;

      const serverAfterHack: Server = {
        ...preppedServer,
        moneyAvailable: postHackMoney,
      };

      const growThreads = ns.formulas?.hacking
        ? Math.ceil(ns.formulas.hacking.growThreads(serverAfterHack, player, moneyMax))
        : Math.ceil(ns.growthAnalyze(target, growthFactor));

      const weaken2Threads = Math.ceil((growThreads * 0.004) / 0.05);

      const batchRam =
        hackThreads * RAM_HACK +
        weaken1Threads * RAM_WEAKEN +
        growThreads * RAM_GROW +
        weaken2Threads * RAM_WEAKEN;

      if (!Number.isFinite(batchRam) || batchRam > maxRam) return null;

      const calcMaxBatches = Math.min(MAX_BATCH_CAP, Math.floor(maxRam / batchRam));
      if (calcMaxBatches < 1) return null;

      const profitPerBatch = moneyMax * actualGreed;
      const greedScore = (profitPerBatch / weakenTime) * Math.min(calcMaxBatches, 50);

      const p: BatchPlan = {
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
      };

      return { p, greedScore };
    };

    // Step 1: Grobsuche
    const greedSteps = [0.01, 0.02, 0.03, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    let bestCoarseGreed = 0.01;

    for (const greed of greedSteps) {
      const res = evaluateGreed(greed);
      if (res && res.greedScore > bestGreedScore) {
        bestGreedScore = res.greedScore;
        optimalTargetPlan = res.p;
        bestCoarseGreed = greed;
      }
    }

    // Step 2: Feinsuche im Umkreis des besten Grobwerts
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

  return bestPlan;
}