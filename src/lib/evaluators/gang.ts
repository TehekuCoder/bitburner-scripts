// lib/evaluators/gang.ts
import { NS } from "@ns";
import { PurchaseEvaluator, PurchaseRequest, PurchasePriority, PurchaseCategory } from "/lib/types/finance.js";
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
    const equipCache = equipmentNames.map(equip => {
      try {
        return {
          name: equip,
          cost: ns.gang.getEquipmentCost(equip),
          type: ns.gang.getEquipmentType(equip)
        };
      } catch {
        return null;
      }
    }).filter(Boolean) as { name: string; cost: number; type: string }[];

    for (const equip of equipCache) {
      for (const memberName of memberNames) {
        try {
          const memberInfo = ns.gang.getMemberInformation(memberName);

          if (memberInfo.upgrades.includes(equip.name) || memberInfo.augmentations.includes(equip.name)) {
            continue;
          }

          let priority = PurchasePriority.LOW;
          let score = 20;
          let reason = "Allgemeines Upgrade";

          if (isHacking) {
            if (equip.type === "Rootkit") {
              priority = PurchasePriority.HIGH;
              score = 85;
              reason = "Essentielles Hacking-Rootkit";
            } else if (equip.type === "Augmentation") {
              priority = PurchasePriority.MEDIUM;
              score = 70;
              reason = "Gang Augmentation (Permanent)";
            } else {
              priority = PurchasePriority.LOW;
              score = 15;
              reason = "Combat-Equipment für Hacking-Gang";
            }
          } else {
            if (equip.type === "Weapon" || equip.type === "Armor" || equip.type === "Vehicle") {
              priority = PurchasePriority.HIGH;
              score = 80;
              reason = "Kampfausrüstung";
            } else if (equip.type === "Augmentation") {
              priority = PurchasePriority.HIGH;
              score = 90;
              reason = "Combat Augmentation (Permanent)";
            } else if (equip.type === "Rootkit") {
              priority = PurchasePriority.LOW;
              score = 10;
              reason = "Rootkit für Combat-Gang";
            }
          }

          requests.push({
            id: `gang-${memberName}-${equip.name}`,
            category: "GANG_EQUIPMENT" as PurchaseCategory,
            priority,
            score,
            cost: equip.cost,
            description: `Gang '${memberName}': ${equip.name} (${reason})`,
            action: {
              script: "core/purchase-action.js",
              args: ["gang-buy-equipment", memberName, equip.name]
            }
          });
        } catch {
          continue;
        }
      }
    }

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, GangEvaluator);
}