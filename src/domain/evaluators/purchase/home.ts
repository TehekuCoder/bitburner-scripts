// evaluators/purchase/home.ts

import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/shared/types/finance.js";
import { hasSingularity, loadBnMults, adjustPriorityByMult } from "lib/utils.js";
import { runEvaluator } from "../evaluator-runner.js";
import { PATHS } from "/infrastructure/runtime/paths";

export const HomeEvaluator: PurchaseEvaluator = {
  category: "HOME_SERVER" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    if (!hasSingularity(ns)) return [];

    const bnMults = loadBnMults(ns);
    
    // 🔴 1. Multiplikatoren laden (PascalCase & snake_case Fallbacks)
    const ramCostMult = bnMults.HomeComputerRamCost ?? 1.0;
    const cloudLimitMult = bnMults.CloudServerLimit ?? 1.0;
    const cloudCostMult = bnMults.CloudServerCost ?? 1.0;

    const ramEfficiency = ramCostMult > 0 ? 1 / ramCostMult : 1.0;
    
    // Wenn Cloud-Server eingeschränkt/teuer sind, gewinnt Home-RAM an strategischem Wert
    const cloudRestricted = cloudLimitMult <= 0 || cloudCostMult > 5.0;
    const homeImportanceBonus = cloudRestricted ? 1.5 : 1.0;
    const effectiveRamEfficiency = ramEfficiency * homeImportanceBonus;

    const requests: PurchaseRequest[] = [];
    const playerMoney = ns.getServerMoneyAvailable("home");

    // 🟢 2. HOME RAM EVALUATION
    const currentRam = ns.getServerMaxRam("home");
    let ramCost = 0;

    try {
      ramCost = ns.singularity.getUpgradeHomeRamCost();
    } catch {
      return []; // Singularity API nicht verfügbar
    }

    if (ramCost > 0 && Number.isFinite(ramCost)) {
      let basePriority = PurchasePriority.LOW;
      let baseScore = 30;

      // Dynamische Priorisierung basierend auf kritischen Infrastruktur-Grenzen
      if (currentRam < 64) {
        // ⚡ Mindest-RAM für Basis-Automation: NIEMALS runterstufen!
        basePriority = PurchasePriority.CRITICAL;
        baseScore = 100;
      } else if (currentRam < 512) {
        basePriority = PurchasePriority.HIGH;
        baseScore = 85;
      } else if (currentRam < 4096) {
        basePriority = PurchasePriority.MEDIUM;
        baseScore = 65;
      } else {
        basePriority = PurchasePriority.LOW;
        baseScore = 35;
      }

      // Basis-RAM (<64GB) wird vor der Herabstufung durch Multiplikatoren geschützt
      let priority = currentRam < 64 
        ? basePriority 
        : adjustPriorityByMult(basePriority, effectiveRamEfficiency);

      const score = currentRam < 64
        ? baseScore
        : Math.max(1, Math.floor(baseScore * Math.min(2.0, effectiveRamEfficiency)));

      // Notbremse bei extremem Missverhältnis zum Kontostand
      if (ramCost > playerMoney * 50 && priority < PurchasePriority.LOW) {
        priority = (priority + 1) as PurchasePriority;
      }

      requests.push({
        id: `home-ram-${currentRam * 2}gb`,
        category: "HOME_SERVER" as PurchaseCategory,
        priority,
        score,
        cost: ramCost,
        description: `Home RAM (${ns.format.ram(currentRam)} ➔ ${ns.format.ram(currentRam * 2)}) [Mult: ${ramCostMult.toFixed(2)}]`,
        action: {
          script: PATHS.app.actions.singularity,
          args: ["home-upgrade-ram"],
        },
      });
    }

    // 🟢 3. HOME CORES EVALUATION
    let currentCores = 1;
    let coresCost = 0;

    try {
      currentCores = ns.getServer("home").cpuCores;
      coresCost = ns.singularity.getUpgradeHomeCoresCost();
    } catch {
      return requests;
    }

    if (coresCost > 0 && Number.isFinite(coresCost)) {
      let basePriority = PurchasePriority.LOW;
      let baseScore = 20;

      const isRamMaxed = ramCost <= 0 || !Number.isFinite(ramCost);
      const isCoreVeryCheap = isRamMaxed || ramCost > coresCost * 8;

      if (currentCores < 2) {
        basePriority = PurchasePriority.MEDIUM;
        baseScore = 60;
      } else if (currentCores < 8 && isCoreVeryCheap) {
        basePriority = PurchasePriority.MEDIUM;
        baseScore = 50;
      } else if (currentCores < 16 && isCoreVeryCheap) {
        basePriority = PurchasePriority.LOW;
        baseScore = 30;
      }

      requests.push({
        id: `home-cores-${currentCores + 1}`,
        category: "HOME_SERVER" as PurchaseCategory,
        priority: basePriority,
        score: baseScore,
        cost: coresCost,
        description: `Home Cores (${currentCores} ➔ ${currentCores + 1})`,
        action: {
          script: PATHS.app.actions.singularity,
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