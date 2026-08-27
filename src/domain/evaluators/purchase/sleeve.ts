import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/shared/types/finance.js";
import { SleeveMode } from "/shared/types/sleeves.js";
import { runEvaluator } from "../evaluator-runner.js";
import { loadBnMults, adjustPriorityByMult } from "/lib/utils.js";
import { PATHS } from "/infrastructure/runtime/paths.js";

export interface SleeveStateEvaluation {
  sleeveId: number;
  shock: number;
  sync: number;
  currentTask: string;
  recommendedMode: SleeveMode;
}

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

export const SleeveEvaluator: PurchaseEvaluator = {
  category: "SLEEVE_AUG" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    if (!ns.sleeve) return [];

    const bnMults = loadBnMults(ns);
    // Da Sleeve-Augs im Gegensatz zu Spieler-Augs im Preis STABIL bleiben, 
    // sind sie bei hohem AugmentationMoneyCost-Multiplikator NOCH wertvoller!
    const costMult = bnMults.AugmentationMoneyCost ?? 1.0;
    const efficiencyMult = Math.max(1.0, costMult * 1.2);

    const requests: PurchaseRequest[] = [];
    const numSleeves = ns.sleeve.getNumSleeves();

    for (let sleeveId = 0; sleeveId < numSleeves; sleeveId++) {
      try {
        const sleeveStats = ns.sleeve.getSleeve(sleeveId);

        // Bei extrem hohem Shock (> 95%) nur Speicher/Sync-Augs zulassen
        if (sleeveStats.shock > 95) continue;

        const shockFactor = (100 - sleeveStats.shock) / 100;
        const purchasableAugs = ns.sleeve.getSleevePurchasableAugs(sleeveId);
        
        // Bereits installierte Augmentationen abfragen
        const installedAugs = ns.sleeve.getSleeveAugmentations(sleeveId);
        const installedCount = installedAugs.length;

        // Balance-Faktor: Reduziert Score leicht pro bereits installierter Augmentation,
        // damit verwaiste Sleeves nachgezogen werden.
        const balanceFactor = 1 / (1 + installedCount * 0.15);

        // Sleeve 0 ist oft der wichtigste Akteur (z.B. Infiltration / Hacking)
        const sleevePriorityBonus = sleeveId === 0 ? 1.2 : 1.0;

        for (const aug of purchasableAugs) {
          let basePriority = PurchasePriority.LOW;
          let baseScore = 15;
          let reason = "General Stat Boost";

          // 1. Essentielle Meta-Augmentationen (Memory / Synchro)
          if (aug.name.includes("Memory") || aug.name.includes("Synchro")) {
            basePriority = PurchasePriority.HIGH;
            baseScore = 100;
            reason = "Essentielles Memory/Sync Upgrade";
          } 
          // 2. Hacking & Combat Haupt-Augmentationen
          else if (
            aug.name.includes("NeuroLink") ||
            aug.name.includes("BitWire") ||
            aug.name.includes("CRANial")
          ) {
            basePriority = PurchasePriority.MEDIUM;
            baseScore = 65;
            reason = "Hacking Efficiency Upgrade";
          } else if (
            aug.name.includes("Bionic") ||
            aug.name.includes("Graphene")
          ) {
            basePriority = PurchasePriority.MEDIUM;
            baseScore = 50;
            reason = "Combat Multiplier Upgrade";
          }

          const priority = adjustPriorityByMult(basePriority, efficiencyMult);
          
          // Berechneter Score unter Berücksichtigung von Shock, Balancierung und Sleeve-Rolle
          const score = Math.max(
            1,
            Math.floor(
              baseScore * 
              efficiencyMult * 
              shockFactor * 
              balanceFactor * 
              sleevePriorityBonus
            )
          );

          requests.push({
            id: `sleeve-${sleeveId}-aug-${aug.name.replace(/\s+/g, "-")}`,
            category: "SLEEVE_AUG" as PurchaseCategory,
            priority,
            score,
            cost: aug.cost,
            description: `Sleeve #${sleeveId} (${installedCount} Augs): '${aug.name}' (${reason})`,
            action: {
              script: PATHS.app.actions.sleeve,
              args: ["sleeve-purchase-aug", sleeveId, aug.name],
            },
          });
        }
      } catch {
        /* Falls API-Zugriff fehlschlägt */
      }
    }

    // Sortierung nach Score; bei gleichem Score gewinnt der Sleeve mit WENIGER Augmentationen (Tie-Breaker)
    return requests
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 8); // Max 8 Anträge gleichzeitig zulassen
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, SleeveEvaluator);
}