// evaluators/purchase/gang.ts

import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/shared/types/finance.js";
import { runEvaluator } from "../evaluator-runner.js";
import { loadBnMults, adjustPriorityByMult } from "lib/utils.js";
import { PATHS } from "/infrastructure/runtime/paths";

export const GangEvaluator: PurchaseEvaluator = {
  category: "GANG_EQUIPMENT" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    // 🔴 1. API-Verfügbarkeit & Status-Check
    if (!ns.gang) return [];
    try {
      if (!ns.gang.inGang()) return [];
    } catch {
      return [];
    }

    const currentMoney = ns.getServerMoneyAvailable("home");
    if (currentMoney <= 0) return [];

    // 🔴 2. BitNode-Multiplikatoren auswerten
    const bnMults = loadBnMults(ns);
    const softcapMult = bnMults.GangSoftcap ?? 1.0;
    const gangAugMult =
      bnMults.GangUniqueAugs ?? 1.0;

    // Wenn der Softcap 0 ist, generiert die Gang kaum/keinen Ertrag
    if (softcapMult <= 0) return [];

    const gangEfficiency = Math.max(0.1, softcapMult);
    const augEfficiency =
      gangAugMult > 0 ? (1 / gangAugMult) * gangEfficiency : gangEfficiency;

    const requests: PurchaseRequest[] = [];

    let info;
    let memberNames: string[];
    let equipmentNames: string[];

    try {
      info = ns.gang.getGangInformation();
      memberNames = ns.gang.getMemberNames();
      equipmentNames = ns.gang.getEquipmentNames();
    } catch {
      return [];
    }

    const isHacking = info.isHacking;

    // 🟢 3. Equipment-Daten cachen
    const equipCache = equipmentNames
      .map((equip) => {
        try {
          const cost = ns.gang.getEquipmentCost(equip);
          if (cost > currentMoney) return null;

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

    // 🟢 4. Requests pro Member & Equipment generieren
    for (const equip of equipCache) {
      const isAugmentation = equip.type === "Augmentation";
      const effMult = isAugmentation ? augEfficiency : gangEfficiency;

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
              baseScore = 80;
              reason = "Hacking-Rootkit";
            } else if (isAugmentation) {
              // Augmentationen sind permanent (überstehen Member-Ascension)
              basePriority = PurchasePriority.HIGH;
              baseScore = 90;
              reason = "Permanent Hacking Augmentation";
            } else {
              return; // Unnötigen Kram für Hacking-Gangs ignorieren
            }
          } else {
            if (
              equip.type === "Weapon" ||
              equip.type === "Armor" ||
              equip.type === "Vehicle"
            ) {
              basePriority = PurchasePriority.MEDIUM;
              baseScore = 70;
              reason = "Kampfausrüstung";
            } else if (isAugmentation) {
              // Augmentationen sind permanent (überstehen Member-Ascension)
              basePriority = PurchasePriority.HIGH;
              baseScore = 90;
              reason = "Permanent Combat Augmentation";
            } else if (equip.type === "Rootkit") {
              return; // Rootkits für Combat-Gangs ignorieren
            }
          }

          // Rang-Staffelung: Ältere/höhere Member zuerst ausrüsten
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
              script: PATHS.app.actions.gang,
              args: ["gang-buy-equipment", memberName, equip.name],
            },
          });
        } catch {
          // Member-Status konnte nicht gelesen werden
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
