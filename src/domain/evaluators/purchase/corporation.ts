import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/shared/types/finance.js";
import { runEvaluator } from "../evaluator-runner.js";
import {
  loadBnMults,
  adjustPriorityByMult,
  isCorporationViable,
} from "lib/utils.js";
import { PATHS } from "/infrastructure/runtime/paths";

const CORP_NAME = "Philip Matrix";

export const CorporationEvaluator: PurchaseEvaluator = {
  category: "CORPORATION" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    // 🔴 1. Viability & API Check (nutzt die zentrale Logik)
    if (!isCorporationViable(ns)) return [];

    try {
      if (ns.corporation.hasCorporation()) return [];
    } catch {
      return [];
    }

    const bnMults = loadBnMults(ns);
    const valMult = bnMults.CorporationValuation ?? 1.0;

    // 🟢 2. Kosten & Priorität ermitteln
    const currentBn = ns.getResetInfo().currentNode;
    const isFreeInBn3 = currentBn === 3;
    const cost = isFreeInBn3 ? 0 : 150_000_000_000;

    let basePriority = isFreeInBn3
      ? PurchasePriority.CRITICAL
      : PurchasePriority.HIGH;

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
