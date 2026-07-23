import { NS, Server } from "@ns";
import { BatchPlan } from "../core/types";
import { calculateBatch } from "./batch-calculator.js";
import { PATH_GROW, PATH_WEAKEN, SPACER, BATCH_GAP } from "../lib/constants.js";
import { Logger } from "../core/logger.js";

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
      const ramGrow = ns.getScriptRam(PATH_GROW);
      const ramWeaken = ns.getScriptRam(PATH_WEAKEN);

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

        // 💥 FIX: Grow-Threads dürfen das Einzelserver-Limit nicht sprengen
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
      // HWGW-PHASE (Greed-Optimierung)
      // ==========================================
      let optimalPlan: BatchPlan | null = null;
      const startGreed = virtualFreeRam < 256 ? 0.01 : 0.1;
      const maxGreed = safeHwgwRam > 8000 ? 0.25 : 0.7;

      let low = startGreed;
      let high = maxGreed;

      while (high - low > 0.001) {
        const mid = (low + high) / 2;
        const p = calculateBatch(ns, t, bnMults, mid, SPACER);
        if (p && p.totalRam <= safeHwgwRam) {
          optimalPlan = p;
          low = mid;
        } else {
          high = mid;
        }
      }

      if (optimalPlan) {
        const pctPerThread = ns.formulas?.hacking
          ? ns.formulas.hacking.hackPercent(server, player)
          : ns.hackAnalyze(t);
        const revenue = optimalPlan.hackThreads * pctPerThread * moneyMax;

        const gap = Math.max(BATCH_GAP, SPACER * 4);
        const timeMaxBatches = Math.floor(optimalPlan.weakenTime / gap);
        const ramMaxBatches = Math.floor(safeHwgwRam / optimalPlan.totalRam);
        const calcMaxBatches = Math.max(
          1,
          Math.min(ramMaxBatches, timeMaxBatches, 80),
        );

        let score =
          (revenue * calcMaxBatches) / (optimalPlan.weakenTime / 1000);

        if (t === currentTarget) {
          score *= 1.25;
        }

        if (score > bestScore) {
          bestScore = score;
          bestTarget = t;
          bestPlan = optimalPlan;
          maxBatches = calcMaxBatches;
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