import { NS } from "@ns";
import { PurchaseCategory, PurchaseRequest, PurchaseEvaluator } from "/shared/types/finance.js";
import { groupRequestsByCategory } from "./request-batches.js";

export const FINANCE_PORT = 10;

export interface EvaluatorBatch {
  category: PurchaseCategory;
  requests: PurchaseRequest[];
}

export function submitPurchaseRequests(
  ns: NS,
  category: PurchaseCategory,
  requests: PurchaseRequest[]
): void {
  const port = ns.getPortHandle(FINANCE_PORT);
  for (const batch of groupRequestsByCategory(category, requests)) {
    const serializedBatch: EvaluatorBatch = {
      category: batch.category as PurchaseCategory,
      requests: batch.requests,
    };
    if (!port.tryWrite(JSON.stringify(serializedBatch))) {
      ns.print(
        `[FINANCE-PORT] Port ${FINANCE_PORT} ist voll; Batch für ${batch.category} wurde nicht übertragen.`,
      );
    }
  }
}

export async function runEvaluator(ns: NS, evaluator: PurchaseEvaluator): Promise<void> {
  ns.disableLog("ALL");
  const requests = evaluator.getRequests(ns);

  // Sende das Paket IMMER (auch leere [] als Heartbeat [✓] fürs UI)
  submitPurchaseRequests(ns, evaluator.category, requests);
}