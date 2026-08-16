// lib/evaluators/cloud.ts
import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/lib/types/finance.js";
import { runEvaluator } from "/lib/evaluator-runner.js";
import { loadBnMults, adjustPriorityByMult } from "lib/utils.js";

const PSERV_PREFIX = "cloud-";
const INITIAL_RAM = 8;
const MIN_HOME_RAM_FOR_PSERVS = 64;
const BASELINE_TARGET_RAM = 32; // 🎯 Ziel-RAM vor regulärer Staffelung

export const PservEvaluator: PurchaseEvaluator = {
  category: "PURCHASED_SERVER",

  getRequests(ns: NS): PurchaseRequest[] {
    const bnMults = loadBnMults(ns);

    // 🔴 Hard Check: Cloud Server Limit aus BN Multipliers (v3.01+)
    const limitMult =
      bnMults.CloudServerLimit ?? bnMults.CloudServerLimit ?? 1.0;
    const limit = ns.cloud.getServerLimit();
    if (limit === 0 || limitMult <= 0) return [];

    // Kosten-Multiplikator berechnen
const costMult = bnMults.CloudServerCost ?? bnMults.CloudServerCost ?? 1.0;
    const efficiencyMult = costMult > 0 ? 1 / costMult : 1.0;

    const maxRam = ns.cloud.getRamLimit();
    const owned = ns.cloud.getServerNames();
    const isHomeUnderpowered =
      ns.getServerMaxRam("home") < MIN_HOME_RAM_FOR_PSERVS;

    const requests: PurchaseRequest[] = [];

    // 1. NEUE SERVER KAUFEN
    if (owned.length < limit) {
      const cost = ns.cloud.getServerCost(INITIAL_RAM);
      if (cost > 0 && Number.isFinite(cost)) {
        let index = 0;
        while (owned.includes(`${PSERV_PREFIX}${index}`)) index++;

        const basePriority = isHomeUnderpowered
          ? PurchasePriority.LOW
          : PurchasePriority.HIGH;

        const priority = adjustPriorityByMult(basePriority, efficiencyMult);
        const baseScore = isHomeUnderpowered ? 10 : 95;
        const score = Math.max(1, Math.floor(baseScore * efficiencyMult));

        requests.push({
          id: `cloud-buy-${PSERV_PREFIX}${index}`,
          category: "PURCHASED_SERVER" as PurchaseCategory,
          priority,
          score,
          cost,
          description: `Server kaufen: ${PSERV_PREFIX}${index} (${INITIAL_RAM}GB) [${owned.length + 1}/${limit}]`,
          action: {
            script: "core/actions/act-cloud.js",
            args: ["cloud-buy", `${PSERV_PREFIX}${index}`, INITIAL_RAM],
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

          let basePriority = PurchasePriority.LOW;
          let score = 5;

          if (!isHomeUnderpowered) {
            if (isUnderBaseline) {
              basePriority = PurchasePriority.HIGH;
              score = 90;
            } else {
              basePriority =
                currentRam < 128
                  ? PurchasePriority.HIGH
                  : currentRam < 1024
                    ? PurchasePriority.MEDIUM
                    : PurchasePriority.LOW;

              const rawScore = Math.max(20, 90 - Math.log2(currentRam) * 2);
              score = Math.min(85, rawScore);
            }
          }

          const priority = adjustPriorityByMult(basePriority, efficiencyMult);
          score = Math.max(1, Math.floor(score * efficiencyMult));

          requests.push({
            id: `cloud-upgrade-${hostname}-${nextRam}gb`,
            category: "PURCHASED_SERVER" as PurchaseCategory,
            priority,
            score,
            cost: upgradeCost,
            description: `Server Upgrade: ${hostname} (${currentRam}GB ➔ ${nextRam}GB)${isUnderBaseline ? " ⚡ [Baseline Push]" : ""}`,
            action: {
              script: "core/actions/act-cloud.js",
              args: ["cloud-upgrade", hostname, nextRam],
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
