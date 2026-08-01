import { NS } from "@ns";
import { PurchaseEvaluator, PurchaseRequest, PurchasePriority } from "/lib/types/finance.js";
import { SleeveMode } from "/lib/types/sleeves.js";
import { runEvaluator } from "/lib/evaluator-runner.js";

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
  category: "SLEEVE_AUG",

  getRequests(ns: NS): PurchaseRequest[] {
    if (!ns.sleeve) return [];

    const requests: PurchaseRequest[] = [];
    const numSleeves = ns.sleeve.getNumSleeves();

    for (let sleeveId = 0; sleeveId < numSleeves; sleeveId++) {
      try {
        const purchasableAugs = ns.sleeve.getSleevePurchasableAugs(sleeveId);

        for (const aug of purchasableAugs) {
          let priority = PurchasePriority.LOW;
          let score = 10;
          let reason = "Stat Enhancement";

          // Priorisierung nach Nutzen
          if (aug.name.includes("Memory") || aug.name.includes("Synchro")) {
            priority = PurchasePriority.HIGH;
            score = 90;
            reason = "Essentielles Memory/Sync Upgrade";
          } else if (aug.name.includes("NeuroLink") || aug.name.includes("BitWire")) {
            priority = PurchasePriority.MEDIUM;
            score = 60;
            reason = "Hacking Efficiency Upgrade";
          }

          requests.push({
            id: `sleeve-${sleeveId}-aug-${aug.name}`,
            category: "SLEEVE_AUG",
            priority,
            score,
            cost: aug.cost,
            description: `Sleeve #${sleeveId}: Augmentation '${aug.name}' (${reason})`,
            action: {
              script: "core/purchase-action.js",
              args: ["sleeve-purchase-aug", sleeveId, aug.name],
            },
          });
        }
      } catch {
        /* Falls Sleeve-API noch eingeschränkt ist */
      }
    }

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, SleeveEvaluator);
}