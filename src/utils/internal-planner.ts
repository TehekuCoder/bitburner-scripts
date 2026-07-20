import { NS, Server } from "@ns";
import { BatchPlan } from "../core/types";
import { calculateBatch } from "./batch-calculator.js";
import { PATH_GROW, PATH_WEAKEN, SPACER } from "../lib/constants.js";
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

  const safeHwgwRam = virtualFreeRam * 0.8;
  const safePrepRam = virtualFreeRam * 0.9;

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

    if (minPlan.totalRam > maxRam * 0.5) return false;
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
      // PREP-PHASE
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
        const maxPossibleWeaken = Math.floor(safePrepRam / ramWeaken);
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
        const maxGrowUnits = Math.floor(safePrepRam / ramPerGrowUnit);
        growThreads = Math.min(totalNeededGrow, maxGrowUnits);

        if (growThreads <= 0) continue;

        // 🛠️ FIX: String `t` als Core-Parameter vermeiden -> direkt x 0.004
        const growSec = growThreads * 0.004;
        weaken2Threads = Math.ceil(growSec / weakenPotency);
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

      // 🧠 POTENTIAL-SCORING:
      // Berechne, was das Ziel NACH dem Prep in HWGW leisten wird.
      const potHwgwPlan = calculateBatch(ns, t, bnMults, 0.2, SPACER);
      let score = (moneyMax / (tW || 1)) * 0.1; // Fallback

      if (potHwgwPlan) {
        const pctPerThread = ns.formulas?.hacking
          ? ns.formulas.hacking.hackPercent(server, player)
          : ns.hackAnalyze(t);
        const potRevenue = potHwgwPlan.hackThreads * pctPerThread * moneyMax;
        // 80% des HWGW-Potenzials vergeben
        score = (potRevenue / (potHwgwPlan.weakenTime / 1000)) * 0.8;
      }

      // 🎯 TARGET LOCK-IN (Bonus ERST NACH der Potenzial-Berechnung anwenden!):
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

      // 🛡️ DYNAMISCHER MAX-GREED:
      // Wenn wir viel RAM haben (> 8 TB), begrenzen wir den Greed auf max. 25%.
      // Tiefe Pipelines mit z.B. 20 Batches laufen bei 20% Greed absolut bombensicher.
      const maxGreed = safeHwgwRam > 8000 ? 0.25 : 0.7;

      for (let greed = maxGreed; greed >= startGreed; greed -= 0.05) {
        const p = calculateBatch(ns, t, bnMults, greed, SPACER);
        if (p && p.totalRam <= safeHwgwRam) {
          optimalPlan = p;
          break;
        }
      }

      if (optimalPlan) {
        const pctPerThread = ns.formulas?.hacking
          ? ns.formulas.hacking.hackPercent(server, player)
          : ns.hackAnalyze(t);
        const revenue = optimalPlan.hackThreads * pctPerThread * moneyMax;
        const score = revenue / (optimalPlan.weakenTime / 1000);

        if (score > bestScore) {
          bestScore = score;
          bestTarget = t;
          bestPlan = optimalPlan;

          const maxSimultaneousBatches = Math.floor(
            safeHwgwRam / optimalPlan.totalRam,
          );
          maxBatches = Math.max(1, Math.min(25, maxSimultaneousBatches));
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
