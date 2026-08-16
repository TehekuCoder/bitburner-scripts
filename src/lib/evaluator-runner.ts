import { NS } from "@ns";
import { PurchaseCategory, PurchaseRequest, PurchaseEvaluator } from "/shared/types/finance.js";

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
  const batch: EvaluatorBatch = { category, requests };

  try {
    port.write(JSON.stringify(batch));
  } catch {
    ns.print(`[FINANCE-PORT] Batch konnte nicht auf Port ${FINANCE_PORT} geschrieben werden: ${category}`);
  }
}

export async function runEvaluator(ns: NS, evaluator: PurchaseEvaluator): Promise<void> {
  ns.disableLog("ALL");
  const requests = evaluator.getRequests(ns);

  // Sende das Paket IMMER (auch leere [] als Heartbeat [✓] fürs UI)
  submitPurchaseRequests(ns, evaluator.category, requests);
}