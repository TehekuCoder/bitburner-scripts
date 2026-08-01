// lib/evaluators/home.ts
import { NS } from "@ns";
import { PurchaseEvaluator, PurchaseRequest, PurchasePriority } from "/lib/types/finance.js";
import { hasSingularity } from "/lib/utils.js";
import { runEvaluator } from "/lib/evaluator-runner.js";

export const HomeEvaluator: PurchaseEvaluator = {
  category: "HOME_SERVER",

  getRequests(ns: NS): PurchaseRequest[] {
    if (!hasSingularity(ns)) return [];

    const requests: PurchaseRequest[] = [];
    const currentRam = ns.getServerMaxRam("home");
    const ramCost = ns.singularity.getUpgradeHomeRamCost();

    if (ramCost > 0 && Number.isFinite(ramCost)) {
      requests.push({
        id: `home-ram-${currentRam * 2}gb`,
        category: "HOME_SERVER",
        priority: currentRam < 256 ? PurchasePriority.CRITICAL : PurchasePriority.HIGH,
        score: currentRam < 256 ? 100 : 80,
        cost: ramCost,
        description: `Home RAM (${ns.format.ram(currentRam)} ➔ ${ns.format.ram(currentRam * 2)})`,
        action: {
          script: "core/actions/act-singularity.js",
          args: ["home-upgrade-ram"],
        },
      });
    }

    const currentCores = ns.getServer("home").cpuCores;
    const coresCost = ns.singularity.getUpgradeHomeCoresCost();

    if (coresCost > 0 && Number.isFinite(coresCost)) {
      requests.push({
        id: `home-cores-${currentCores + 1}`,
        category: "HOME_SERVER",
        priority: currentCores < 4 ? PurchasePriority.MEDIUM : PurchasePriority.LOW,
        score: currentCores < 4 ? 75 : 30,
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