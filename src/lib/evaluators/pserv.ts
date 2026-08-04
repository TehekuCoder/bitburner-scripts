// lib/evaluators/pserv.ts
import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/lib/types/finance.js";
import { runEvaluator } from "/lib/evaluator-runner.js";

const PSERV_PREFIX = "pserv-";
const INITIAL_RAM = 8;
const MIN_HOME_RAM_FOR_PSERVS = 64;
const BASELINE_TARGET_RAM = 32; // 🎯 Ziel-RAM vor regulärer Staffelung

export const PservEvaluator: PurchaseEvaluator = {
  category: "PURCHASED_SERVER",

  getRequests(ns: NS): PurchaseRequest[] {
    const limit = ns.cloud.getServerLimit();
    if (limit === 0) return [];

    const maxRam = ns.cloud.getRamLimit();
    const owned = ns.cloud.getServerNames();
    const isHomeUnderpowered =
      ns.getServerMaxRam("home") < MIN_HOME_RAM_FOR_PSERVS;

    const requests: PurchaseRequest[] = [];

    // 1. NEUE SERVER KAUFEN (HIGH Priority)
    if (owned.length < limit) {
      const cost = ns.cloud.getServerCost(INITIAL_RAM);
      if (cost > 0 && Number.isFinite(cost)) {
        let index = 0;
        while (owned.includes(`${PSERV_PREFIX}${index}`)) index++;

        const priority = isHomeUnderpowered
          ? PurchasePriority.LOW
          : PurchasePriority.HIGH;
        const score = isHomeUnderpowered ? 10 : 95;

        requests.push({
          id: `pserv-buy-${PSERV_PREFIX}${index}`,
          category: "PURCHASED_SERVER" as PurchaseCategory,
          priority,
          score,
          cost,
          description: `Server kaufen: ${PSERV_PREFIX}${index} (${INITIAL_RAM}GB) [${owned.length + 1}/${limit}]`,
          action: {
            script: "core/actions/act-cloud.js",
            args: ["pserv-buy", `${PSERV_PREFIX}${index}`, INITIAL_RAM],
          },
        });
      }
    }

    // 2. BESTEHENDE SERVER UPGRADEN
    for (const hostname of owned) {
      const currentRam = ns.getServerMaxRam(hostname);
      const nextRam = currentRam * 2;

      if (nextRam <= maxRam) {
        const upgradeCost = ns.cloud.getServerUpgradeCost(hostname, nextRam);

        if (upgradeCost > 0 && Number.isFinite(upgradeCost)) {
          const isUnderBaseline = currentRam < BASELINE_TARGET_RAM;

          let priority = PurchasePriority.LOW;
          let score = 5;

          if (!isHomeUnderpowered) {
            if (isUnderBaseline) {
              priority = PurchasePriority.HIGH;
              score = 90;
            } else {
              priority =
                currentRam < 128
                  ? PurchasePriority.HIGH
                  : currentRam < 1024
                    ? PurchasePriority.MEDIUM
                    : PurchasePriority.LOW;

              const baseScore = Math.max(20, 90 - Math.log2(currentRam) * 2);
              score = Math.min(85, baseScore);
            }
          }

          requests.push({
            id: `pserv-upgrade-${hostname}-${nextRam}gb`,
            category: "PURCHASED_SERVER" as PurchaseCategory,
            priority,
            score,
            cost: upgradeCost,
            description: `Server Upgrade: ${hostname} (${currentRam}GB ➔ ${nextRam}GB)${isUnderBaseline ? " ⚡ [Baseline Push]" : ""}`,
            action: {
              script: "core/actions/act-cloud.js",
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
