// evaluators/purchase/corporation.ts

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

const CORP_NAME = "Philip Matrix";

export const CorporationEvaluator: PurchaseEvaluator = {
  category: "CORPORATION" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    // 🔴 1. API Availability Check (Benötigt BN3 oder SF3)
    if (!ns.corporation) return [];

    try {
      if (ns.corporation.hasCorporation()) return [];
    } catch {
      return []; // Fallback, falls API im aktuellen BN gesperrt ist
    }

    // 🔴 2. BitNode Multipliers Evaluieren
    const bnMults = loadBnMults(ns);
    const valMult =
      bnMults.CorporationValuation ?? 1.0;
    const softcapMult =
      bnMults.CorporationSoftcap ?? 1.0;

    // Falls Corporations im BitNode totgelegt sind
    if (valMult <= 0 || softcapMult <= 0) return [];

    // 🟢 3. Kosten & Priorität ermitteln
    const currentBn = ns.getResetInfo().currentNode;
    const isFreeInBn3 = currentBn === 3;
    const cost = isFreeInBn3 ? 0 : 150_000_000_000; // 150 Mrd. $ außerhalb BN3

    // Basis-Priorität festlegen
    let basePriority = isFreeInBn3
      ? PurchasePriority.CRITICAL
      : PurchasePriority.HIGH;

    // Außerhalb BN3: Bei reduzierten Corp-Multiplikatoren Priorität anpassen
    if (!isFreeInBn3) {
      basePriority = adjustPriorityByMult(basePriority, valMult);
    }

    const baseScore = isFreeInBn3
      ? 100
      : Math.min(100, Math.floor(90 * valMult));

    return [
      {
        id: "corp-create-initial",
        category: "CORPORATION" as PurchaseCategory,
        priority: basePriority,
        score: Math.max(1, baseScore),
        cost,
        description: `Corporation gründen: "${CORP_NAME}" (${cost === 0 ? "GRATIS in BN3" : "$150B"}) [Valuation-Mult: ${valMult.toFixed(2)}]`,
        action: {
          script: PATHS.app.actions.corporation,
          args: ["corp-create", CORP_NAME],
        },
      },
    ];
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, CorporationEvaluator);
}
