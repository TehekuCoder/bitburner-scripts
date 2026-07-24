import { NS, Server } from "@ns";

import { calculateBatch } from "./batch-calculator.js";
import {
  PATH_HACK,
  PATH_GROW,
  PATH_WEAKEN,
  SPACER,
  BATCH_GAP,
} from "/lib/constants.js";
import { Logger } from "/lib/logger.js";
import { BatchPlan } from "/lib/types.js";

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

  const ramHack = ns.getScriptRam(PATH_HACK);
  const ramGrow = ns.getScriptRam(PATH_GROW);
  const ramWeaken = ns.getScriptRam(PATH_WEAKEN);

  // Single-Host-Limit: Ein einzelnes Skript (z.B. grow mit N Threads)
  // MUSS am Stück auf einem einzigen Host Platz finden!
  const maxSingleScriptRam = maxRam * 0.85;
  const safeHwgwRam = virtualFreeRam * 0.8;
  const safePrepRam = Math.min(virtualFreeRam * 0.9, maxSingleScriptRam * 3);

  const targets = servers.filter((s) => {
    if (targetBlacklist.has(s) || !ns.hasRootAccess(s)) return false;
    const sObj = ns.getServer(s);
    const moneyMax = sObj.moneyMax ?? 0;
    if (
      moneyMax <= 0 ||
      (sObj.requiredHackingSkill ?? 0) > player.skills.hacking
    )
      return false;

    const minPlan = calculateBatch(ns, s, bnMults, 0.05, SPACER);
    if (!minPlan) return false;

    if (minPlan.totalRam > maxRam * 0.8) return false;
    if (minPlan.totalRam > safeHwgwRam) return false;

    // Single-Host Check bereits beim Filtern: Passt der Mindest-Batch auf einen Host?
    const maxScriptRam = Math.max(
      minPlan.hackThreads * ramHack,
      minPlan.growThreads * ramGrow,
      minPlan.weaken1Threads * ramWeaken,
      minPlan.weaken2Threads * ramWeaken,
    );
    if (maxScriptRam > maxSingleScriptRam) return false;

    return true;
  });

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
      // ==========================================
      // PREP-PHASE (Chunking gegen RAM-Fragmentierung)
      // ==========================================
      const weakenPotency = 0.05 * (bnMults.ServerWeakenRate ?? 1.0);

      let weaken1Threads = 0;
      let growThreads = 0;
      let weaken2Threads = 0;

      const diffAmt = hackDifficulty - minDifficulty;

      if (diffAmt > 0.01) {
        const totalNeededWeaken = Math.ceil(diffAmt / weakenPotency);
        // Begrenze auf das, was auf EINEN Host passt UND in den freien RAM
        const maxPossibleWeaken = Math.floor(
          Math.min(safePrepRam, maxSingleScriptRam) / ramWeaken,
        );
        weaken1Threads = Math.min(totalNeededWeaken, maxPossibleWeaken);
        if (weaken1Threads <= 0) continue;
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
          : Math.ceil(ns.getServerGrowth(t) / 10);

        const secPerGrow = 0.004;
        const ramPerGrowUnit =
          ramGrow + (secPerGrow / weakenPotency) * ramWeaken;

        // GROW-LIMIT: Darf weder den RAM des Einzel-Hosts noch safePrepRam sprengen
        const maxGrowByHost = Math.floor(maxSingleScriptRam / ramGrow);
        const maxGrowByRam = Math.floor(safePrepRam / ramPerGrowUnit);
        const maxGrowUnits = Math.min(maxGrowByHost, maxGrowByRam);

        growThreads = Math.min(totalNeededGrow, maxGrowUnits);

        if (growThreads <= 0) continue;

        const growSecIncrease = growThreads * 0.004;
        weaken2Threads = Math.ceil(growSecIncrease / weakenPotency) + 1;
      }

      const totalRam =
        (weaken1Threads + weaken2Threads) * ramWeaken + growThreads * ramGrow;
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
        growDelay: 0,
        weaken2Delay: 0,
        hackTime: 0,
        growTime: tG,
        weakenTime: tW,
        totalRam,
        executionTime: tW,
      };

      // POTENTIAL-SCORING:
      const potHwgwPlan = calculateBatch(ns, t, bnMults, 0.2, SPACER);
      let score = (moneyMax / (tW || 1)) * 0.1;

      if (potHwgwPlan) {
        const pctPerThread = ns.formulas?.hacking
          ? ns.formulas.hacking.hackPercent(server, player)
          : ns.hackAnalyze(t);
        const potRevenue = potHwgwPlan.hackThreads * pctPerThread * moneyMax;
        score = (potRevenue / (potHwgwPlan.weakenTime / 1000)) * 0.8;
      }

      // TARGET LOCK-IN BONUS:
      if (t === currentTarget) {
        score *= 1.5;
      }

      if (score > bestScore) {
        bestScore = score;
        bestTarget = t;
        bestPlan = prepPlan;
        maxBatches = 1;
      }
    } else {
      // ==========================================
      // HWGW-PHASE (Durchsatz-Optimierung $/s)
      // ==========================================
      let optimalPlan: BatchPlan | null = null;
      let bestGreedScore = -1;
      let calcMaxBatchesForBestPlan = 1;

      // Greed-Sweep (1% bis 50%): Finde den Greed mit dem besten Gesamtdurchsatz
      for (let greed = 0.01; greed <= 0.5; greed += 0.01) {
        const p = calculateBatch(ns, t, bnMults, greed, SPACER);
        if (!p) continue;

        // 1. Single-Host Check: Kein Einzelskript darf den größten Worker überlasten
        const maxScriptRamInBatch = Math.max(
          p.hackThreads * ramHack,
          p.growThreads * ramGrow,
          p.weaken1Threads * ramWeaken,
          p.weaken2Threads * ramWeaken,
        );

        if (maxScriptRamInBatch > maxSingleScriptRam) continue;

        // 2. HWGW RAM Limit Check
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
          Math.min(ramMaxBatches, timeMaxBatches, 25),
        );

        // Durchsatz-Score ($ / Sekunde) für die gesamte Overlap-Pipeline
        const greedScore = (revenue * calcMaxBatches) / (p.weakenTime / 1000);

        if (greedScore > bestGreedScore) {
          bestGreedScore = greedScore;
          optimalPlan = p;
          calcMaxBatchesForBestPlan = calcMaxBatches;
        }
      }

      if (optimalPlan) {
        let score = bestGreedScore;

        if (t === currentTarget) {
          score *= 1.25;
        }

        if (score > bestScore) {
          bestScore = score;
          bestTarget = t;
          bestPlan = optimalPlan;
          maxBatches = calcMaxBatchesForBestPlan;
        }
      }
    }
  }

  if (!bestTarget || !bestPlan) return null;

  logger?.info(
    `[Planner] 🎯 Ziel gewählt: ${bestTarget} | Score: ${bestScore.toFixed(0)} | Max Batches: ${maxBatches}`,
  );
  return { target: bestTarget, plan: bestPlan, maxBatches };
}
