// domain/evaluators/purchase/bladeburner.ts

import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/shared/types/finance.js";
import { runEvaluator } from "../evaluator-runner.js";
import { PATHS } from "/infrastructure/runtime/paths.js";
import { BLADEBURNER_SKILL_PRIORITIES } from "/shared/constants/bladeburner.js";

export const BladeburnerEvaluator: PurchaseEvaluator = {
  category: "BLADEBURNER" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    if (!ns.bladeburner.inBladeburner()) {
      return [];
    }

    const availableSp = ns.bladeburner.getSkillPoints();
    if (availableSp <= 0) return [];

    const requests: PurchaseRequest[] = [];

    for (const item of BLADEBURNER_SKILL_PRIORITIES) {
      const currentLevel = ns.bladeburner.getSkillLevel(item.name);
      
      if (item.maxLevel && currentLevel >= item.maxLevel) continue;

      const spCost = ns.bladeburner.getSkillUpgradeCost(item.name);

      if (spCost > 0 && availableSp >= spCost) {
        const levelPenalty = Math.floor(currentLevel / 10);
        const calculatedScore = Math.max(10, item.weight - levelPenalty * 5);

        const priority =
          calculatedScore >= 80
            ? PurchasePriority.HIGH
            : calculatedScore >= 50
              ? PurchasePriority.MEDIUM
              : PurchasePriority.LOW;

        // Fallback falls PATHS.app.actions.bladeburner noch nicht in paths.ts registriert ist
        const actionScript =
          (PATHS.app.actions as Record<string, string>).bladeburner ??
          "/app/actions/act-bladeburner.js";

        requests.push({
          id: `bladeburner-skill-${item.name.toLowerCase().replace(/['\s]/g, "-")}`,
          category: "BLADEBURNER" as PurchaseCategory,
          priority,
          score: calculatedScore,
          cost: 0,
          description: `Bladeburner Skill: ${item.name} (Lvl ${currentLevel} ➔ ${currentLevel + 1}) [Kostet ${spCost} SP]`,
          action: {
            script: actionScript,
            args: ["upgrade-skill", item.name, "", 1],
          },
        });
      }
    }

    return requests.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, BladeburnerEvaluator);
}