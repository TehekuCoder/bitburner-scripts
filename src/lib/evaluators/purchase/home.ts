import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/shared/types/finance.js";
import { hasSingularity, loadBnMults, adjustPriorityByMult } from "/lib/utils.js";
import { runEvaluator } from "/lib/evaluator-runner.js";

export const HomeEvaluator: PurchaseEvaluator = {
  category: "HOME_SERVER" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    if (!hasSingularity(ns)) return [];

    const bnMults = loadBnMults(ns);
    const ramCostMult = bnMults.HomeComputerRamCost ?? 1.0;
    const ramEfficiency = ramCostMult > 0 ? 1 / ramCostMult : 1.0;

    const requests: PurchaseRequest[] = [];
    const playerMoney = ns.getServerMoneyAvailable("home");

    // --- 1. HOME RAM EVALUATION ---
    const currentRam = ns.getServerMaxRam("home");
    const ramCost = ns.singularity.getUpgradeHomeRamCost();

    if (ramCost > 0 && Number.isFinite(ramCost)) {
      let basePriority = PurchasePriority.LOW;
      let baseScore = 30;

      if (currentRam < 128) {
        basePriority = PurchasePriority.CRITICAL;
        baseScore = 100;
      } else if (currentRam < 1024) { // < 1 TB
        basePriority = PurchasePriority.HIGH;
        baseScore = 85;
      } else if (currentRam < 16384) { // < 16 TB
        basePriority = PurchasePriority.MEDIUM;
        baseScore = 65;
      } else {
        basePriority = PurchasePriority.LOW;
        baseScore = 40;
      }

      let priority = adjustPriorityByMult(basePriority, ramEfficiency);
      const score = Math.max(1, Math.floor(baseScore * ramEfficiency));

      // Bremse bei extremem Missverhältnis zum Kontostand
      if (ramCost > playerMoney * 50 && priority < PurchasePriority.LOW) {
        priority = (priority + 1) as PurchasePriority;
      }

      requests.push({
        id: `home-ram-${currentRam * 2}gb`,
        category: "HOME_SERVER" as PurchaseCategory,
        priority,
        score,
        cost: ramCost,
        description: `Home RAM (${ns.format.ram(currentRam)} ➔ ${ns.format.ram(currentRam * 2)})`,
        action: {
          script: "core/actions/act-singularity.js",
          args: ["home-upgrade-ram"],
        },
      });
    }

    // --- 2. HOME CORES EVALUATION ---
    const currentCores = ns.getServer("home").cpuCores;
    const coresCost = ns.singularity.getUpgradeHomeCoresCost();

    if (coresCost > 0 && Number.isFinite(coresCost)) {
      let basePriority = PurchasePriority.LOW;
      let baseScore = 20;

      const isRamMaxed = ramCost <= 0 || !Number.isFinite(ramCost);
      const isCoreVeryCheap = isRamMaxed || ramCost > coresCost * 10;

      if (currentCores < 2) {
        basePriority = PurchasePriority.MEDIUM;
        baseScore = 60;
      } else if (currentCores < 8 && isCoreVeryCheap) {
        basePriority = PurchasePriority.MEDIUM;
        baseScore = 50;
      }

      requests.push({
        id: `home-cores-${currentCores + 1}`,
        category: "HOME_SERVER" as PurchaseCategory,
        priority: basePriority,
        score: baseScore,
        cost: coresCost,
        description: `Home Cores (${currentCores} ➔ ${currentCores + 1})`,
        action: {
          script: "core/actions/act-singularity.js",
          args: ["home-upgrade-cores"],
        },
      });
    }

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, HomeEvaluator);
}