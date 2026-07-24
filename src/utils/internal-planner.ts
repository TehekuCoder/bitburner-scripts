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

  // 💥 FIX 1: Finde den GRÖSSTEN Einzel-Host im Netzwerk für Single-Script Checks
  const largestWorkerRam = servers.reduce((max, s) => {
    if (!ns.hasRootAccess(s)) return max;
    return Math.max(max, ns.getServerMaxRam(s));
  }, 0);

  // Ein einzelnes Skript darf NIEMALS größer sein als der RAM unseres größten Servers!
  const maxSingleScriptRam = largestWorkerRam * 0.95;

  const safeHwgwRam = virtualFreeRam * 0.8;
  const safePrepRam = Math.min(virtualFreeRam * 0.9, maxSingleScriptRam * 3);

  // ----------------------------------------------------------------------
  // 🔍 TARGET-FILTERING
  // ----------------------------------------------------------------------
  const targets = servers.filter((s) => {
    if (targetBlacklist.has(s) || !ns.hasRootAccess(s)) return false;
    const sObj = ns.getServer(s);
    const moneyMax = sObj.moneyMax ?? 0;
    if (
      moneyMax <= 0 ||
      (sObj.requiredHackingSkill ?? 0) > player.skills.hacking
    )
      return false;

    // FIX 2: Prüfe mit minimalem Greed (1%), damit Low-RAM Setups Ziele nicht fälschlicherweise filtern
    const minPlan = calculateBatch(ns, s, bnMults, 0.01, SPACER);
    if (!minPlan) return false;

    if (minPlan.totalRam > maxRam * 0.8) return false;
    if (minPlan.totalRam > safeHwgwRam) return false;

    // Einzelskript-Check gegen den größten Host
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
      // ==================================================================
      // 🛠️ PREP-PHASE (Chunking gegen RAM-Fragmentierung)
      // ==================================================================
      const weakenPotency = 0.05 * (bnMults.ServerWeakenRate ?? 1.0);

      let weaken1Threads = 0;
      let growThreads = 0;
      let weaken2Threads = 0;

      const diffAmt = hackDifficulty - minDifficulty;

      if (diffAmt > 0.01) {
        // Nur Weaken nötig
        const totalNeededWeaken = Math.ceil(diffAmt / weakenPotency);
        const maxPossibleWeaken = Math.floor(
          Math.min(safePrepRam, maxSingleScriptRam) / ramWeaken,
        );
        weaken1Threads = Math.min(totalNeededWeaken, maxPossibleWeaken);
        if (weaken1Threads <= 0) continue;
      } else if (moneyAvailable < moneyMax) {
        // Grow + Weaken2 nötig
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

        // FIX 3: Richtige Chunks berechnen, damit Grow + Weaken2 garantiert in den RAM passen
        const maxGrowByHost = Math.floor(maxSingleScriptRam / ramGrow);
        const maxGrowByRam = Math.floor(safePrepRam / ramPerGrowUnit);
        const maxGrowUnits = Math.min(maxGrowByHost, maxGrowByRam);

        growThreads = Math.min(totalNeededGrow, maxGrowUnits);

        if (growThreads <= 0) continue;

        const growSecIncrease = growThreads * 0.004;
        weaken2Threads = Math.ceil(growSecIncrease / weakenPotency) + 1;
      }

      let totalRam =
        (weaken1Threads + weaken2Threads) * ramWeaken + growThreads * ramGrow;

      // Falls RAM immer noch minimal drüber ist, Threads proportional anpassen
      if (totalRam > safePrepRam && growThreads > 0) {
        const scale = safePrepRam / totalRam;
        growThreads = Math.floor(growThreads * scale);
        const growSecIncrease = growThreads * 0.004;
        weaken2Threads = Math.ceil(growSecIncrease / weakenPotency) + 1;
        totalRam = weaken2Threads * ramWeaken + growThreads * ramGrow;
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
      // ==================================================================
      // 🚀 HWGW-PHASE (Durchsatz-Optimierung $/s)
      // ==================================================================
      let optimalPlan: BatchPlan | null = null;
      let bestGreedScore = -1;
      let calcMaxBatchesForBestPlan = 1;

      for (let greed = 0.01; greed <= 0.5; greed += 0.01) {
        const p = calculateBatch(ns, t, bnMults, greed, SPACER);
        if (!p) continue;

        // 1. Single-Host Check gegen den echten größtmöglichen Worker
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

        // Dynamisches Cap (max. 100 Batches statt starr 25 für High-RAM Late Game)
        const calcMaxBatches = Math.max(
          1,
          Math.min(ramMaxBatches, timeMaxBatches, 100),
        );

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