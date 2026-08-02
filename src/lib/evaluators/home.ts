import { NS } from "@ns";
import { PurchaseEvaluator, PurchaseRequest, PurchasePriority } from "/lib/types/finance.js";
import { hasSingularity } from "/lib/utils.js";
import { runEvaluator } from "/lib/evaluator-runner.js";

export const HomeEvaluator: PurchaseEvaluator = {
  category: "HOME_SERVER",

  getRequests(ns: NS): PurchaseRequest[] {
    if (!hasSingularity(ns)) return [];

    const requests: PurchaseRequest[] = [];
    const playerMoney = ns.getServerMoneyAvailable("home");

    // --- 1. HOME RAM EVALUATION ---
    const currentRam = ns.getServerMaxRam("home");
    const ramCost = ns.singularity.getUpgradeHomeRamCost();

    if (ramCost > 0 && Number.isFinite(ramCost)) {
      let priority = PurchasePriority.LOW;
      let score = 30;

      // Stufenmodell nach Spielfortschritt
      if (currentRam < 128) {
        priority = PurchasePriority.CRITICAL;
        score = 100;
      } else if (currentRam < 1024) { // < 1 TB
        priority = PurchasePriority.HIGH;
        score = 85;
      } else if (currentRam < 16384) { // < 16 TB
        priority = PurchasePriority.MEDIUM;
        score = 65;
      } else {
        priority = PurchasePriority.LOW;
        score = 40;
      }

      // DYNAMISCHE BREMSE:
      // Wenn das RAM-Upgrade mehr als das 50-fache unseres aktuellen Kontostands kostet,
      // stufen wir die Priorität ab, um den Sparmodus für günstigere Sub-Systeme freizugeben.
      if (ramCost > playerMoney * 50 && priority < PurchasePriority.LOW) {
        priority = (priority + 1) as PurchasePriority; // z. B. HIGH (2) -> MEDIUM (3)
      }

      requests.push({
        id: `home-ram-${currentRam * 2}gb`,
        category: "HOME_SERVER",
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
      let priority = PurchasePriority.LOW;
      let score = 20;

      if (currentCores < 2) {
        // Der 2. Core ist extrem günstig und gibt sofort 10% mehr Grow/Weaken-Leistung
        priority = PurchasePriority.MEDIUM;
        score = 60;
      } else if (currentCores < 8 && ramCost > coresCost * 10) {
        // Wenn RAM gerade 10x teurer ist als der nächste Core, schieben wir Cores auf MEDIUM
        priority = PurchasePriority.MEDIUM;
        score = 50;
      }

      requests.push({
        id: `home-cores-${currentCores + 1}`,
        category: "HOME_SERVER",
        priority,
        score,
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