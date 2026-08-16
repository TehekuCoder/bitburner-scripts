// lib/evaluators/sleeve.ts
import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/shared/types/finance.js";
import { SleeveMode } from "/shared/types/sleeves.js";
import { runEvaluator } from "/lib/evaluator-runner.js";
import { loadBnMults, adjustPriorityByMult } from "/lib/utils.js";

export interface SleeveStateEvaluation {
  sleeveId: number;
  shock: number;
  sync: number;
  currentTask: string;
  recommendedMode: SleeveMode;
}

/**
 * Bewertet den Zustand aller Sleeves.
 */
export function evaluateSleeveStates(ns: NS): SleeveStateEvaluation[] {
  if (!ns.sleeve) return [];

  const numSleeves = ns.sleeve.getNumSleeves();
  const evaluations: SleeveStateEvaluation[] = [];

  for (let i = 0; i < numSleeves; i++) {
    const stats = ns.sleeve.getSleeve(i);
    const task = ns.sleeve.getTask(i);
    const taskName = task ? task.type : "None";

    let recommendedMode: SleeveMode = "COMPANY";

    if (stats.shock > 0) {
      recommendedMode = "RECOVERY";
    } else if (stats.sync < 100) {
      recommendedMode = "SYNCHRO";
    }

    evaluations.push({
      sleeveId: i,
      shock: stats.shock,
      sync: stats.sync,
      currentTask: taskName,
      recommendedMode,
    });
  }

  return evaluations;
}

/**
 * Evaluator für den finance-core.ts:
 * Generiert zentral gesteuerte Kaufanträge für Sleeve-Augmentations.
 */
export const SleeveEvaluator: PurchaseEvaluator = {
  category: "SLEEVE_AUG" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    if (!ns.sleeve) return [];

    const bnMults = loadBnMults(ns);
    const costMult = bnMults.AugmentationMoneyCost ?? 1.0;
    const efficiencyMult = costMult > 0 ? 1 / costMult : 1.0;

    const requests: PurchaseRequest[] = [];
    const numSleeves = ns.sleeve.getNumSleeves();

    for (let sleeveId = 0; sleeveId < numSleeves; sleeveId++) {
      try {
        const sleeveStats = ns.sleeve.getSleeve(sleeveId);

        // Bei extrem hohem Shock (> 90%) Aug-Käufe zurückstellen
        if (sleeveStats.shock > 90) continue;

        // Shock-Faktor: Effizienz von Augs steigt mit sinkendem Shock
        const shockFactor = (100 - sleeveStats.shock) / 100;
        const purchasableAugs = ns.sleeve.getSleevePurchasableAugs(sleeveId);

        for (const aug of purchasableAugs) {
          let basePriority = PurchasePriority.LOW;
          let baseScore = 10;
          let reason = "Stat Enhancement";

          // Priorisierung nach Nutzen
          if (aug.name.includes("Memory") || aug.name.includes("Synchro")) {
            basePriority = PurchasePriority.HIGH;
            baseScore = 90;
            reason = "Essentielles Memory/Sync Upgrade";
          } else if (
            aug.name.includes("NeuroLink") ||
            aug.name.includes("BitWire")
          ) {
            basePriority = PurchasePriority.MEDIUM;
            baseScore = 60;
            reason = "Hacking Efficiency Upgrade";
          }

          const priority = adjustPriorityByMult(basePriority, efficiencyMult);
          const score = Math.max(
            1,
            Math.floor(baseScore * efficiencyMult * shockFactor),
          );

          requests.push({
            id: `sleeve-${sleeveId}-aug-${aug.name.replace(/\s+/g, "-")}`,
            category: "SLEEVE_AUG" as PurchaseCategory,
            priority,
            score,
            cost: aug.cost,
            description: `Sleeve #${sleeveId}: Augmentation '${aug.name}' (${reason})`,
            action: {
              script: "core/actions/act-sleeve.js",
              args: ["sleeve-purchase-aug", sleeveId, aug.name],
            },
          });
        }
      } catch {
        /* Falls Sleeve-API noch eingeschränkt ist */
      }
    }

    return requests.sort((a, b) => a.cost - b.cost);
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, SleeveEvaluator);
}
