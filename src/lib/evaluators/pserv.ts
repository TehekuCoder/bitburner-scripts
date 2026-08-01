// lib/evaluators/pserv.ts
import { NS } from "@ns";
import { PurchaseEvaluator, PurchaseRequest, PurchasePriority } from "/lib/types/finance.js";
import { runEvaluator } from "/lib/evaluator-runner.js";

const PSERV_PREFIX = "pserv-";
const INITIAL_RAM = 8;
const MIN_HOME_RAM_FOR_PSERVS = 256;

export const PservEvaluator: PurchaseEvaluator = {
  category: "PURCHASED_SERVER",

  getRequests(ns: NS): PurchaseRequest[] {
    const limit = ns.cloud.getServerLimit();
    if (limit === 0) return []; 

    const maxRam = ns.cloud.getRamLimit();
    const owned = ns.cloud.getServerNames();
    const isHomeUnderpowered = ns.getServerMaxRam("home") < MIN_HOME_RAM_FOR_PSERVS;

    const requests: PurchaseRequest[] = [];

    if (owned.length < limit) {
      const cost = ns.cloud.getServerCost(INITIAL_RAM);
      if (cost > 0 && Number.isFinite(cost)) {
        let index = 0;
        while (owned.includes(`${PSERV_PREFIX}${index}`)) index++;
        
        const priority = isHomeUnderpowered ? PurchasePriority.LOW : (owned.length < 8 ? PurchasePriority.HIGH : PurchasePriority.MEDIUM);

        requests.push({
          id: `pserv-buy-${PSERV_PREFIX}${index}`,
          category: "PURCHASED_SERVER",
          priority,
          score: isHomeUnderpowered ? 10 : 80,
          cost,
          description: `Server kaufen: ${PSERV_PREFIX}${index} (${INITIAL_RAM}GB)`,
          action: {
            script: "core/purchase-action.js",
            args: ["pserv-buy", `${PSERV_PREFIX}${index}`, INITIAL_RAM],
          },
        });
      }
    }

    for (const hostname of owned) {
      const currentRam = ns.getServerMaxRam(hostname);
      const nextRam = currentRam * 2;

      if (nextRam <= maxRam) {
        const upgradeCost = ns.cloud.getServerUpgradeCost(hostname, nextRam);
        if (upgradeCost > 0 && Number.isFinite(upgradeCost)) {
          const priority = isHomeUnderpowered ? PurchasePriority.LOW : (currentRam < 128 ? PurchasePriority.MEDIUM : PurchasePriority.LOW);

          requests.push({
            id: `pserv-upgrade-${hostname}-${nextRam}gb`,
            category: "PURCHASED_SERVER",
            priority,
            score: isHomeUnderpowered ? 5 : Math.max(10, 80 - Math.log2(currentRam) * 5),
            cost: upgradeCost,
            description: `Server Upgrade: ${hostname} (${currentRam}GB ➔ ${nextRam}GB)`,
            action: {
              script: "core/purchase-action.js",
              args: ["pserv-upgrade", hostname, nextRam],
            },
          });
        }
      }
    }

    return requests.sort((a, b) => a.cost - b.cost);
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, PservEvaluator);
}
