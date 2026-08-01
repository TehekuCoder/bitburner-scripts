// lib/evaluators/gang.ts
import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/lib/types/finance.js";
import { runEvaluator } from "/lib/evaluator-runner.js";

export const GangEvaluator: PurchaseEvaluator = {
  category: "GANG_EQUIPMENT",

  getRequests(ns: NS): PurchaseRequest[] {
    if (!ns.gang || !ns.gang.inGang()) return [];

    const requests: PurchaseRequest[] = [];
    const info = ns.gang.getGangInformation();
    const isHacking = info.isHacking;

    const memberNames = ns.gang.getMemberNames();
    const equipmentNames = ns.gang.getEquipmentNames();

    // Cache Equipment-Daten für bessere Performance
    const equipCache = equipmentNames
      .map((equip) => {
        try {
          return {
            name: equip,
            cost: ns.gang.getEquipmentCost(equip),
            type: ns.gang.getEquipmentType(equip),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as { name: string; cost: number; type: string }[];

    for (const equip of equipCache) {
      memberNames.forEach((memberName, idx) => {
        try {
          const memberInfo = ns.gang.getMemberInformation(memberName);

          if (
            memberInfo.upgrades.includes(equip.name) ||
            memberInfo.augmentations.includes(equip.name)
          ) {
            return;
          }

          let priority = PurchasePriority.LOW;
          let baseScore = 20;
          let reason = "Allgemeines Upgrade";

          // lib/evaluators/gang.ts (Ausschnitt aus getRequests)

          if (isHacking) {
            if (equip.type === "Rootkit") {
              priority = PurchasePriority.HIGH;
              baseScore = 85;
              reason = "Essentielles Hacking-Rootkit";
            } else if (equip.type === "Augmentation") {
              // Multi-Milliarden Upgrades gehören in MEDIUM, um Early/Midgame-Transaktionen nicht zu blockieren!
              priority = PurchasePriority.MEDIUM;
              baseScore = 60;
              reason = "Gang Augmentation (Permanent)";
            } else {
              priority = PurchasePriority.LOW;
              baseScore = 15;
              reason = "Combat-Equipment für Hacking-Gang";
            }
          } else {
            if (
              equip.type === "Weapon" ||
              equip.type === "Armor" ||
              equip.type === "Vehicle"
            ) {
              priority = PurchasePriority.HIGH;
              baseScore = 80;
              reason = "Kampfausrüstung";
            } else if (equip.type === "Augmentation") {
              // Multi-Milliarden Upgrades gehören in MEDIUM!
              priority = PurchasePriority.MEDIUM;
              baseScore = 65;
              reason = "Combat Augmentation (Permanent)";
            } else if (equip.type === "Rootkit") {
              priority = PurchasePriority.LOW;
              baseScore = 10;
              reason = "Rootkit für Combat-Gang";
            }
          }

          // Staffelung: Frühere Gang-Member leicht bevorzugen (-0.1 Punkte pro Index)
          // um identische Scores bei allen Members zu vermeiden
          const score = Math.max(1, baseScore - idx * 1.5);

          requests.push({
            id: `gang-${memberName}-${equip.name}`,
            category: "GANG_EQUIPMENT" as PurchaseCategory,
            priority,
            score,
            cost: equip.cost,
            description: `Gang '${memberName}': ${equip.name} (${reason})`,
            action: {
              script: "core/actions/act-gang.js",
              args: ["gang-buy-equipment", memberName, equip.name],
            },
          });
        } catch {
          // Member-Daten konnten nicht gelesen werden
        }
      });
    }

    // Sortierung innerhalb des Evaluators: Höchster Score zuerst, bei gleichem Score das Günstigste
    return requests.sort((a, b) => {
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.cost - b.cost;
    });
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, GangEvaluator);
}
