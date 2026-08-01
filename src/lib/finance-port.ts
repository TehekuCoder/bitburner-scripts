// lib/finance-port.ts

import { NS } from "@ns";
import { PurchaseCategory, PurchaseRequest } from "/lib/types/finance.js";

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

  // Erstelle ein einziges Paket für den gesamten Evaluator-Durchlauf
  const batch: EvaluatorBatch = {
    category,
    requests,
  };

  try {
    // Schreibt exakt 1 Nachricht in den Port (belegt 1/50 Port-Slots)
    port.write(JSON.stringify(batch));
  } catch {
    ns.print(
      `[FINANCE-PORT] Konnte Kaufanfragen-Batch nicht auf Port ${FINANCE_PORT} schreiben: ${category}`
    );
  }
}