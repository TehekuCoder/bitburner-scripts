import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/shared/types/finance.js";
import { runEvaluator } from "../evaluator-runner.js";
import { loadBnMults, adjustPriorityByMult } from "/lib/utils.js";
import { PATHS } from "/infrastructure/runtime/paths.js";

// Erweitertes Interface für die interne Sortierung
interface SleevePurchaseRequest extends PurchaseRequest {
  installedCount: number;
}

export const SleeveEvaluator: PurchaseEvaluator = {
  category: "SLEEVE_AUG" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    if (!ns.sleeve) return [];

    const bnMults = loadBnMults(ns);
    const costMult = bnMults.AugmentationMoneyCost ?? 1.0;
    const efficiencyMult = Math.max(1.0, costMult * 1.2);

    const requests: SleevePurchaseRequest[] = [];
    const numSleeves = ns.sleeve.getNumSleeves();

    for (let sleeveId = 0; sleeveId < numSleeves; sleeveId++) {
      try {
        const sleeveStats = ns.sleeve.getSleeve(sleeveId);

        // Bei sehr hohem Shock (> 90%) lohnen sich Augmentationen kaum
        if (sleeveStats.shock > 90) continue;

        const shockFactor = (100 - sleeveStats.shock) / 100;
        const purchasableAugs = ns.sleeve.getSleevePurchasableAugs(sleeveId);
        const installedAugs = ns.sleeve.getSleeveAugmentations(sleeveId);
        const installedCount = installedAugs.length;

        // Balance-Faktor: Bevorzugt leicht Sleeves mit weniger Augmentationen
        const balanceFactor = 1 / (1 + installedCount * 0.15);
        const sleevePriorityBonus = sleeveId === 0 ? 1.2 : 1.0;

        for (const aug of purchasableAugs) {
          let basePriority = PurchasePriority.LOW;
          let baseScore = 20;
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
            aug.name.includes("CRANial") ||
            aug.name.includes("Neural")
          ) {
            basePriority = PurchasePriority.MEDIUM;
            baseScore = 65;
            reason = "Hacking Efficiency Upgrade";
          } else if (
            aug.name.includes("Bionic") ||
            aug.name.includes("Graphene") ||
            aug.name.includes("Nanofiber")
          ) {
            basePriority = PurchasePriority.MEDIUM;
            baseScore = 50;
            reason = "Combat Multiplier Upgrade";
          }

          // KOSTEN-FAKTOR: Günstige Augmentationen bevorzugen (ROI)
          // Logarithmische Skalierung sorgt dafür, dass sehr billige Augs einen spürbaren Boost bekommen
          const costFactor = Math.max(0.2, 10 / Math.log10(Math.max(10, aug.cost)));

          const priority = adjustPriorityByMult(basePriority, efficiencyMult);
          
          const score = Math.max(
            1,
            Math.floor(
              baseScore * 
              efficiencyMult * 
              shockFactor * 
              balanceFactor * 
              sleevePriorityBonus *
              costFactor
            )
          );

          requests.push({
            id: `sleeve-${sleeveId}-aug-${aug.name.replace(/\s+/g, "-")}`,
            category: "SLEEVE_AUG" as PurchaseCategory,
            priority,
            score,
            cost: aug.cost,
            installedCount,
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

    // Sortierung nach Score; bei gleichem Score gewinnt der Sleeve mit WENIGER Augmentationen
    return requests
      .sort((a, b) => {
        const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        return a.installedCount - b.installedCount;
      })
      .slice(0, 8);
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, SleeveEvaluator);
}