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

export const CorporationEvaluator: PurchaseEvaluator = {
  category: "CORPORATION" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    if (!Boolean(ns.corporation)) return [];
    if (ns.corporation.hasCorporation()) return [];

    // In BN3 ist die Gründung kostenlos ($0), sonst $150B
    const currentBn = ns.getResetInfo().currentNode;
    const cost = currentBn === 3 ? 0 : 150_000_000_000; // 150 Mrd. $ außerhalb BN3

    return [
      {
        id: "corp-create-initial",
        category: "CORPORATION" as PurchaseCategory,
        priority: PurchasePriority.CRITICAL, // In BN3 sofort gründen!
        score: 100,
        cost,
        description: `Corporation gründen: "${CORP_NAME}" (${cost === 0 ? "GRATIS in BN3" : "$150B"})`,
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