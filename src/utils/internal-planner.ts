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
import { Logger } from "/lib/logger.js";
import { BatchPlan } from "/lib/types.js";

// Max. 10 Minuten Laufzeit pro Weaken, um Level-Up-Resets im Mid-Game zu verhindern
const MAX_WEAKEN_TIME_MS = 10 * 60 * 1000;

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
  let bestTarget: string | null = null;
  let bestScore = -1;
  let bestPlan: BatchPlan | null = null;
  let maxBatches = 100;
  let bestTargetIsPrepped = false;

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
  const safeHwgwRam = virtualFreeRam * 0.8;
  const safePrepRam = Math.min(virtualFreeRam * 0.9, maxSingleScriptRam * 3);

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

    if (!ns.hasRootAccess(s)) {
      return false; // Stumm filtern für Nicht-Root-Server
    }

    const sObj = ns.getServer(s);
    const moneyMax = sObj.moneyMax ?? 0;
    if (moneyMax <= 0) return false;

    if ((sObj.requiredHackingSkill ?? 0) > player.skills.hacking) {
      return false; // Stumm filtern für zu schwere Server
    }

    // ⏱️ ZEIT-LIMIT CHECK: Ignoriere Targets mit endlosen Laufzeiten
    const weakenTime =
      ns.formulas?.hacking?.weakenTime(sObj, player) ?? ns.getWeakenTime(s);
    if (weakenTime > MAX_WEAKEN_TIME_MS) {
      logger?.debug(
        `[Planner Filter] ${s}: Verworfen (Weaken-Zeit zu hoch: ${(weakenTime / 1000).toFixed(0)}s).`,
      );
      return false;
    }

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
      // 🛠️ PREP-PHASE
      const weakenPotency = 0.05 * (bnMults.ServerWeakenRate ?? 1.0);
      let weaken1Threads = 0;
      let growThreads = 0;
      let weaken2Threads = 0;

      const diffAmt = hackDifficulty - minDifficulty;

      if (diffAmt > 0.01) {
        const totalNeededWeaken = Math.ceil(diffAmt / weakenPotency);
        const maxPossibleWeaken = Math.floor(
          Math.min(safePrepRam, maxSingleScriptRam) / ramWeaken,
        );
        weaken1Threads = Math.min(totalNeededWeaken, maxPossibleWeaken);
        if (weaken1Threads <= 0) {
          logger?.debug(`[Planner Prep] ${t}: Kann Weaken1-Threads nicht stellen.`);
          continue;
        }
      } else if (moneyAvailable < moneyMax) {
        const virtualServer: Server = {
          ...server,
          hackDifficulty: minDifficulty,
          moneyAvailable: Math.max(1, moneyAvailable),
        };

        const totalNeededGrow = ns.formulas?.hacking
          ? Math.ceil(
              ns.formulas.hacking.growThreads(virtualServer, player, moneyMax),
            )
          : Math.ceil(
              (Math.log(moneyMax / Math.max(1, moneyAvailable)) * 100) /
                ns.getServerGrowth(t),
            );

        const secPerGrow = 0.004;
        const ramPerGrowUnit =
          ramGrow + (secPerGrow / weakenPotency) * ramWeaken;

        const maxGrowByHost = Math.floor(maxSingleScriptRam / ramGrow);
        const maxGrowByRam = Math.floor(safePrepRam / ramPerGrowUnit);
        const maxGrowUnits = Math.min(maxGrowByHost, maxGrowByRam);

        growThreads = Math.min(totalNeededGrow, maxGrowUnits);
        if (growThreads <= 0) {
          logger?.debug(`[Planner Prep] ${t}: Kann Grow-Threads nicht stellen.`);
          continue;
        }

        const growSecIncrease = growThreads * 0.004;
        weaken2Threads = Math.ceil(growSecIncrease / weakenPotency) + 1;
      }

      let totalRam =
        (weaken1Threads + weaken2Threads) * ramWeaken + growThreads * ramGrow;

      if (totalRam > safePrepRam && growThreads > 0) {
        const scale = safePrepRam / totalRam;
        growThreads = Math.floor(growThreads * scale);
        const growSecIncrease = growThreads * 0.004;
        weaken2Threads = Math.ceil(growSecIncrease / weakenPotency) + 1;
        totalRam = weaken2Threads * ramWeaken + growThreads * ramGrow;
      }

      if (totalRam <= 0 || totalRam > safePrepRam) {
        logger?.debug(`[Planner Prep] ${t}: Prep-RAM (${totalRam.toFixed(1)}GB) überschreitet safePrepRam.`);
        continue;
      }

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
        growDelay: 0,
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

      if (t === currentTarget) score *= 1.5;

      const moneyPct = ((moneyAvailable / moneyMax) * 100).toFixed(1);
      logger?.debug(
        `[Planner Evaluator] 🛠️ ${t} (PREP) | Geld: ${moneyPct}% | Sec: +${diffAmt.toFixed(2)} | Plan: W1:${weaken1Threads} G:${growThreads} W2:${weaken2Threads} | Score: ${score.toFixed(0)}`,
      );

      if (score > bestScore) {
        bestScore = score;
        bestTarget = t;
        bestPlan = prepPlan;
        bestTargetIsPrepped = false;

        // 🚀 Dynamic Prep-Pipeline: Parallelisierbare Prep-Batches berechnen
        const gap = Math.max(BATCH_GAP, SPACER * 4);
        const timeMaxBatches = Math.floor(tW / gap);
        const ramMaxBatches = Math.floor(safePrepRam / totalRam);
        maxBatches = Math.max(1, Math.min(ramMaxBatches, timeMaxBatches, 20));
      }
    } else {
      // 🚀 HWGW-PHASE
      let optimalPlan: BatchPlan | null = null;
      let bestGreedScore = -1;
      let calcMaxBatchesForBestPlan = 1;
      let bestGreedPct = 0;

      for (let greed = 0.01; greed <= 0.5; greed += 0.01) {
        const p = calculateBatch(ns, t, bnMults, greed, SPACER);
        if (!p) continue;

        const maxScriptRamInBatch = Math.max(
          p.hackThreads * ramHack,
          p.growThreads * ramGrow,
          p.weaken1Threads * ramWeaken,
          p.weaken2Threads * ramWeaken,
        );

        if (maxScriptRamInBatch > maxSingleScriptRam) continue;
        if (p.totalRam > safeHwgwRam) continue;

        const pctPerThread = ns.formulas?.hacking
          ? ns.formulas.hacking.hackPercent(server, player)
          : ns.hackAnalyze(t);
        const revenue = p.hackThreads * pctPerThread * moneyMax;

        const gap = Math.max(BATCH_GAP, SPACER * 4);
        const timeMaxBatches = Math.floor(p.weakenTime / gap);
        const ramMaxBatches = Math.floor(safeHwgwRam / p.totalRam);

        const calcMaxBatches = Math.max(
          1,
          Math.min(ramMaxBatches, timeMaxBatches, 100),
        );

        const greedScore = (revenue * calcMaxBatches) / (p.weakenTime / 1000);

        if (greedScore > bestGreedScore) {
          bestGreedScore = greedScore;
          optimalPlan = p;
          calcMaxBatchesForBestPlan = calcMaxBatches;
          bestGreedPct = greed;
        }
      }

      if (optimalPlan) {
        let score = bestGreedScore;
        if (t === currentTarget) score *= 1.25;

        logger?.debug(
          `[Planner Evaluator] 🚀 ${t} (HWGW) | Optimal Greed: ${(bestGreedPct * 100).toFixed(0)}% | RAM/Batch: ${optimalPlan.totalRam.toFixed(1)}GB | Score: ${score.toFixed(0)}`,
        );

        if (score > bestScore) {
          bestScore = score;
          bestTarget = t;
          bestPlan = optimalPlan;
          bestTargetIsPrepped = true;
          maxBatches = calcMaxBatchesForBestPlan;
        }
      } else {
        logger?.debug(
          `[Planner HWGW] ${t}: Kein passender Greed-Plan gefunden (Limits überschritten).`,
        );
      }
    }
  }

  if (!bestTarget || !bestPlan) {
    logger?.debug(
      "[Planner] Kein Target mit ausreichendem Score/RAM gefunden.",
    );
    return null;
  }

  const mode = bestTargetIsPrepped ? "HWGW" : "PREP";
  logger?.info(
    `[Planner] 🎯 Ziel gewählt: ${bestTarget} (${mode}) | Score: ${bestScore.toFixed(0)} | RAM/Batch: ${bestPlan.totalRam.toFixed(1)}GB | Max Batches: ${maxBatches}`,
  );

  return { target: bestTarget, plan: bestPlan, maxBatches };
}