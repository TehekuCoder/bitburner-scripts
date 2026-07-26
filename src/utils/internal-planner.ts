import { NS, Server } from "@ns";
import { calculateBatch } from "./batch-calculator.js";
import {
  PATH_HACK,
  PATH_GROW,
  PATH_WEAKEN,
  SPACER,
  HOME_RAM_RESERVE,
  BATCH_GAP,
} from "/lib/constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { BatchPlan } from "/lib/types.js";

// Absolute Obergrenze für simulierte Batches (Schutz vor Bitburner/JS-Garbage-Collector Lag)
const MAX_BATCH_CAP = 2500;
const MAX_PREP_CAP = 250;

/**
 * Hystereseschwellenwert für Zielwechsel.
 * 0.75 bedeutet: Das aktuelle Ziel wird behalten, solange sein Score mindestens 75%
 * des absoluten Top-Scores beträgt (das neue Ziel müsste also > 33% besser sein).
 */
const HYSTERESIS_THRESHOLD = 0.75;

interface EvaluatedCandidate {
  target: string;
  plan: BatchPlan;
  maxBatches: number;
  score: number;
  isPrepped: boolean;
}

export function internalPlanner(
  ns: NS,
  servers: string[],
  maxRam: number,
  virtualFreeRam: number,
  bnMults: any,
  targetBlacklist: Map<string, number>,
  queueLength: number,
  logger?: Logger,
  currentTarget?: string | null,
): { target: string; plan: BatchPlan; maxBatches: number } | null {
  const player = ns.getPlayer();
  const candidates: EvaluatedCandidate[] = [];

  const ramHack = ns.getScriptRam(PATH_HACK);
  const ramGrow = ns.getScriptRam(PATH_GROW);
  const ramWeaken = ns.getScriptRam(PATH_WEAKEN);

  // Größten physischen Host im Netzwerk ermitteln
  const largestWorkerHost = servers.reduce((max, s) => {
    if (!ns.hasRootAccess(s)) return max;
    const maxRamHost =
      s === "home"
        ? Math.max(0, ns.getServerMaxRam("home") - HOME_RAM_RESERVE)
        : ns.getServerMaxRam(s);
    return Math.max(max, maxRamHost);
  }, 0);

  // Cap für ein einzelnes Skript basiert auf der physischen Max-Kapazität
  const maxSingleScriptRam = Math.max(1.75, largestWorkerHost * 0.95);
  const safeHwgwRam = virtualFreeRam * 0.9;
  const safePrepRam = virtualFreeRam * 0.95;

  if (safeHwgwRam <= 0) {
    logger?.debug("[Planner] Kein freier RAM im Netzwerk vorhanden.");
    return null;
  }

  // ----------------------------------------------------------------------
  // 🔍 TARGET-FILTERING
  // ----------------------------------------------------------------------
  const targets = servers.filter((s) => {
    if (s === "home") return false;

    if (targetBlacklist.has(s) && (targetBlacklist.get(s) ?? 0) > Date.now()) {
      logger?.debug(`[Planner Filter] ${s}: Verworfen (Blacklist).`);
      return false;
    }

    if (!ns.hasRootAccess(s)) return false;

    const sObj = ns.getServer(s);
    const moneyMax = sObj.moneyMax ?? 0;
    if (moneyMax <= 0) return false;

    if ((sObj.requiredHackingSkill ?? 0) > player.skills.hacking) return false;

    return true;
  });

  if (targets.length === 0) {
    logger?.debug(
      "[Planner] Keine gültigen Targets gefunden (Root / Skill / Zeit-Filter).",
    );
    return null;
  }

  // ----------------------------------------------------------------------
  // 📊 TARGET-EVALUIERUNG
  // ----------------------------------------------------------------------
  for (const t of targets) {
    const server = ns.getServer(t);
    const minDifficulty = server.minDifficulty ?? 1;
    const hackDifficulty = server.hackDifficulty ?? 1;
    const moneyMax = server.moneyMax ?? 0;
    const moneyAvailable = server.moneyAvailable ?? 0;

    if (moneyMax <= 0) continue;

    const isPrepped =
      hackDifficulty <= minDifficulty + 0.1 &&
      moneyAvailable >= moneyMax * 0.99;

    if (!isPrepped) {
      // 🛠️ PREP-PHASE (Kombiniertes Weaken + Grow in einem Batch)
      const weakenPotency = 0.05 * (bnMults.ServerWeakenRate ?? 1.0);
      let weaken1Threads = 0;
      let growThreads = 0;
      let weaken2Threads = 0;
      let neededPrepBatches = 1;

      const diffAmt = hackDifficulty - minDifficulty;

      if (diffAmt > 0.5) {
        const totalNeededWeaken = Math.ceil(diffAmt / weakenPotency);
        const maxPossibleWeaken = Math.floor(
          Math.min(safePrepRam, maxSingleScriptRam) / ramWeaken,
        );
        weaken1Threads = Math.min(totalNeededWeaken, maxPossibleWeaken);
      } else if (diffAmt > 0.01) {
        weaken1Threads = Math.ceil(diffAmt / weakenPotency);
      }

      if (moneyAvailable < moneyMax) {
        const virtualServer: Server = {
          ...server,
          hackDifficulty: minDifficulty,
          moneyAvailable: Math.max(1, moneyAvailable),
        };

        const growthMult = bnMults.ServerGrowthRate ?? 1.0;
        const rawGrowThreads = ns.formulas?.hacking
          ? Math.ceil(
              ns.formulas.hacking.growThreads(virtualServer, player, moneyMax),
            )
          : Math.ceil(
              (Math.log(moneyMax / Math.max(1, moneyAvailable)) * 100) /
                ns.getServerGrowth(t),
            );

        const totalNeededGrow = ns.formulas?.hacking
          ? rawGrowThreads
          : Math.ceil(rawGrowThreads / growthMult);

        const secPerGrow = 0.004;
        const ramPerGrowUnit =
          ramGrow + (secPerGrow / weakenPotency) * ramWeaken;

        const remainingPrepRam = Math.max(
          0,
          safePrepRam - weaken1Threads * ramWeaken,
        );

        const maxGrowByHost = Math.floor(maxSingleScriptRam / ramGrow);
        const maxGrowByRam = Math.floor(remainingPrepRam / ramPerGrowUnit);
        const maxGrowUnits = Math.max(0, Math.min(maxGrowByHost, maxGrowByRam));

        growThreads = Math.min(totalNeededGrow, maxGrowUnits);

        if (growThreads > 0) {
          const growSecIncrease = growThreads * 0.004;
          weaken2Threads = Math.ceil(growSecIncrease / weakenPotency) + 1;
        }

        const neededWeakenBatches =
          weaken1Threads > 0
            ? Math.ceil(diffAmt / (weaken1Threads * weakenPotency))
            : 1;
        const neededGrowBatches =
          growThreads > 0 ? Math.ceil(totalNeededGrow / growThreads) : 1;
        neededPrepBatches = Math.max(neededWeakenBatches, neededGrowBatches);
      }

      let totalRam =
        (weaken1Threads + weaken2Threads) * ramWeaken + growThreads * ramGrow;

      if (totalRam > safePrepRam && growThreads > 0) {
        const scale = safePrepRam / totalRam;
        growThreads = Math.floor(growThreads * scale);
        const growSecIncrease = growThreads * 0.004;
        weaken2Threads = Math.ceil(growSecIncrease / weakenPotency) + 1;
        totalRam =
          (weaken1Threads + weaken2Threads) * ramWeaken + growThreads * ramGrow;
      }

      if (totalRam <= 0 || totalRam > safePrepRam) continue;

      const tW =
        ns.formulas?.hacking?.weakenTime(server, player) ?? ns.getWeakenTime(t);
      const tG =
        ns.formulas?.hacking?.growTime(server, player) ?? ns.getGrowTime(t);

      const prepPlan: BatchPlan = {
        target: t,
        hackThreads: 0,
        weaken1Threads,
        growThreads,
        weaken2Threads,
        hackDelay: 0,
        weaken1Delay: 0,
        growDelay: Math.max(0, tW - SPACER - tG),
        weaken2Delay: 0,
        hackTime: 0,
        growTime: tG,
        weakenTime: tW,
        totalRam,
        executionTime: tW,
      };

      const potHwgwPlan = calculateBatch(ns, t, bnMults, 0.2, SPACER);
      let score = (moneyMax / (tW || 1)) * 0.1;

      if (potHwgwPlan) {
        const pctPerThread = ns.formulas?.hacking
          ? ns.formulas.hacking.hackPercent(server, player)
          : ns.hackAnalyze(t);
        const potRevenue = potHwgwPlan.hackThreads * pctPerThread * moneyMax;
        score = (potRevenue / (potHwgwPlan.weakenTime / 1000)) * 0.8;
      }

      const gap = Math.max(BATCH_GAP, SPACER * 4);
      const timeMaxBatches = Math.floor(tW / gap);
      const ramMaxBatches = Math.floor(safePrepRam / totalRam);
      const maxAllowedPrep = Math.min(MAX_PREP_CAP, neededPrepBatches);
      const prepMaxBatches = Math.max(
        1,
        Math.min(ramMaxBatches, timeMaxBatches, maxAllowedPrep),
      );

      candidates.push({
        target: t,
        plan: prepPlan,
        maxBatches: prepMaxBatches,
        score,
        isPrepped: false,
      });
    } else {
      // 🚀 HWGW-PHASE (2-Pass Greed Search)
      let optimalPlan: BatchPlan | null = null;
      let bestGreedScore = -1;
      let calcMaxBatchesForBestPlan = 1;

      const evaluateGreed = (greed: number) => {
        const p = calculateBatch(ns, t, bnMults, greed, SPACER);
        if (!p) return null;

        const maxScriptRamInBatch = Math.max(
          p.hackThreads * ramHack,
          p.growThreads * ramGrow,
          p.weaken1Threads * ramWeaken,
          p.weaken2Threads * ramWeaken,
        );

        if (maxScriptRamInBatch > maxSingleScriptRam) return null;
        if (p.totalRam > safeHwgwRam) return null;

        const pctPerThread = ns.formulas?.hacking
          ? ns.formulas.hacking.hackPercent(server, player)
          : ns.hackAnalyze(t);
        const revenue = p.hackThreads * pctPerThread * moneyMax;

        const gap = Math.max(BATCH_GAP, SPACER * 4);
        const timeMaxBatches = Math.floor(p.weakenTime / gap);
        const ramMaxBatches = Math.floor(safeHwgwRam / p.totalRam);

        const calcMaxBatches = Math.max(
          1,
          Math.min(ramMaxBatches, timeMaxBatches, MAX_BATCH_CAP),
        );

        const greedScore = (revenue * calcMaxBatches) / (p.weakenTime / 1000);

        return { p, calcMaxBatches, greedScore };
      };

      // 1️⃣ Grobsuche (0.05 bis 0.95)
      let bestCoarseGreed = 0.05;
      for (let greed = 0.05; greed <= 0.95; greed += 0.05) {
        const res = evaluateGreed(greed);
        if (res && res.greedScore > bestGreedScore) {
          bestGreedScore = res.greedScore;
          optimalPlan = res.p;
          calcMaxBatchesForBestPlan = res.calcMaxBatches;
          bestCoarseGreed = greed;
        }
      }

      // 2️⃣ Feinsuche (±4% in 1%-Schritten)
      const minFine = Math.max(0.01, Number((bestCoarseGreed - 0.04).toFixed(2)));
      const maxFine = Math.min(0.95, Number((bestCoarseGreed + 0.04).toFixed(2)));

      for (let greed = minFine; greed <= maxFine; greed += 0.01) {
        const roundedGreed = Number(greed.toFixed(2));
        const res = evaluateGreed(roundedGreed);
        if (res && res.greedScore > bestGreedScore) {
          bestGreedScore = res.greedScore;
          optimalPlan = res.p;
          calcMaxBatchesForBestPlan = res.calcMaxBatches;
        }
      }

      if (optimalPlan) {
        candidates.push({
          target: t,
          plan: optimalPlan,
          maxBatches: calcMaxBatchesForBestPlan,
          score: bestGreedScore,
          isPrepped: true,
        });
      }
    }
  }

  if (candidates.length === 0) {
    logger?.debug(
      "[Planner] Kein Target mit ausreichendem Score/RAM gefunden.",
    );
    return null;
  }

  // ----------------------------------------------------------------------
  // ⚖️ HYSTERESE & STICKY-TARGET ENTSCHEIDUNG
  // ----------------------------------------------------------------------
  candidates.sort((a, b) => b.score - a.score);
  const topCandidate = candidates[0];

  const currentCandidate = currentTarget
    ? candidates.find((c) => c.target === currentTarget)
    : null;

  let selected = topCandidate;

  if (
    currentCandidate &&
    currentCandidate.score >= topCandidate.score * HYSTERESIS_THRESHOLD
  ) {
    selected = currentCandidate;
    logger?.debug(
      `📌 Hystereseschutz aktiv: Bleibe bei ${currentTarget} (Score: ${currentCandidate.score.toFixed(0)} vs Top ${topCandidate.target}: ${topCandidate.score.toFixed(0)})`,
    );
  } else if (currentTarget && selected.target !== currentTarget) {
    logger?.info(
      `🔄 Target-Wechsel gerechtfertigt: ${currentTarget} (${currentCandidate?.score.toFixed(0) ?? 0}) -> ${selected.target} (${selected.score.toFixed(0)})`,
    );
  }

  const mode = selected.isPrepped ? "HWGW" : "PREP";
  logger?.info(
    `[Planner] 🎯 Ziel gewählt: ${selected.target} (${mode}) | Score: ${selected.score.toFixed(0)} | RAM/Batch: ${selected.plan.totalRam.toFixed(1)}GB | Max Batches: ${selected.maxBatches}`,
  );

  return {
    target: selected.target,
    plan: selected.plan,
    maxBatches: selected.maxBatches,
  };
}