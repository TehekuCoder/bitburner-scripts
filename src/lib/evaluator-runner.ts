import { NS } from "@ns";
import { PurchaseEvaluator } from "/lib/types/finance.js";
import { submitPurchaseRequests } from "/lib/finance-port.js";

export async function runEvaluator(ns: NS, evaluator: PurchaseEvaluator): Promise<void> {
  ns.disableLog("ALL");
  const requests = evaluator.getRequests(ns);
  if (requests.length === 0) return;
  submitPurchaseRequests(ns, requests);
}
