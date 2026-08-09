import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/lib/types/finance.js";
import { runEvaluator } from "/lib/evaluator-runner.js";
import { loadBnMults, adjustPriorityByMult } from "/lib/utils.js";

export const GangEvaluator: PurchaseEvaluator = {
  category: "GANG_EQUIPMENT" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    if (!ns.gang || !ns.gang.inGang()) return [];

    const currentMoney = ns.getServerMoneyAvailable("home");
    if (currentMoney <= 0) return [];

    const bnMults = loadBnMults(ns);
    const gangAugMult = bnMults.GangUniqueAugs ?? 1.0;
    const gangAugEfficiency = gangAugMult > 0 ? 1 / gangAugMult : 1.0;

    const requests: PurchaseRequest[] = [];
    const info = ns.gang.getGangInformation();
    const isHacking = info.isHacking;

    const memberNames = ns.gang.getMemberNames();
    const equipmentNames = ns.gang.getEquipmentNames();

    // Cache Equipment-Daten & filtere direkt unbezahlbare Gegenstände heraus
    const equipCache = equipmentNames
      .map((equip) => {
        try {
          const cost = ns.gang.getEquipmentCost(equip);
          if (cost > currentMoney) return null; // Direkt ignorieren wenn unbezahlbar

          return {
            name: equip,
            cost,
            type: ns.gang.getEquipmentType(equip),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as { name: string; cost: number; type: string }[];

    if (equipCache.length === 0) return [];

    for (const equip of equipCache) {
      const isAugmentation = equip.type === "Augmentation";
      const effMult = isAugmentation ? gangAugEfficiency : 1.0;

      memberNames.forEach((memberName, idx) => {
        try {
          const memberInfo = ns.gang.getMemberInformation(memberName);

          if (
            memberInfo.upgrades.includes(equip.name) ||
            memberInfo.augmentations.includes(equip.name)
          ) {
            return;
          }

          let basePriority = PurchasePriority.LOW;
          let baseScore = 20;
          let reason = "Allgemeines Upgrade";

          if (isHacking) {
            if (equip.type === "Rootkit") {
              basePriority = PurchasePriority.HIGH;
              baseScore = 85;
              reason = "Essentielles Hacking-Rootkit";
            } else if (isAugmentation) {
              basePriority = PurchasePriority.MEDIUM;
              baseScore = 60;
              reason = "Gang Augmentation (Permanent)";
            } else {
              // Irrelevante Upgrades überspringen, um Trash-Requests zu vermeiden
              return;
            }
          } else {
            if (
              equip.type === "Weapon" ||
              equip.type === "Armor" ||
              equip.type === "Vehicle"
            ) {
              basePriority = PurchasePriority.HIGH;
              baseScore = 80;
              reason = "Kampfausrüstung";
            } else if (isAugmentation) {
              basePriority = PurchasePriority.MEDIUM;
              baseScore = 65;
              reason = "Combat Augmentation (Permanent)";
            } else if (equip.type === "Rootkit") {
              // Irrelevante Rootkits für Combat Gang überspringen
              return;
            }
          }

          // Staffelung nach Member-Index (höhere Ränge bevorzugen)
          const memberScore = Math.max(1, baseScore - idx * 1.5);

          const priority = adjustPriorityByMult(basePriority, effMult);
          const score = Math.max(1, Math.floor(memberScore * effMult));

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

    // Nach Score & Preis sortieren und auf MAX 12 Anfragen begrenzen
    return requests
      .sort((a, b) => {
        const scoreA = a.score ?? 0;
        const scoreB = b.score ?? 0;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return a.cost - b.cost;
      })
      .slice(0, 12);
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, GangEvaluator);
}