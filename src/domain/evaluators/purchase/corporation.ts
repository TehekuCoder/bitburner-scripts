import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/shared/types/finance.js";
import { runEvaluator } from "../evaluator-runner.js";
import { PATHS } from "/infrastructure/runtime/paths";

const CORP_NAME = "Philip Matrix";
const CORP_FOUNDING_COST = 150_000_000_000; // 150 Mrd. $ außerhalb BN3

export const CorporationEvaluator: PurchaseEvaluator = {
  category: "CORPORATION" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    // 1. API-Check
    if (!Boolean(ns.corporation)) return [];

    // 2. Wenn bereits gegruendet -> Keine Anfragen
    if (ns.corporation.hasCorporation()) return [];

    // 3. Kaufanfrage für die Erstgründung
    return [
      {
        id: "corp-create-initial",
        category: "CORPORATION" as PurchaseCategory,
        priority: PurchasePriority.HIGH,
        score: 95, // Sehr hohes Scaling, da Corp die stärkste Geldquelle im Game ist
        cost: CORP_FOUNDING_COST,
        description: `Corporation gründen: "${CORP_NAME}" ($150B)`,
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