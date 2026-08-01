// lib/evaluator-runner.ts

import { NS } from "@ns";
import { PurchaseEvaluator } from "/lib/types/finance.js";
import { submitPurchaseRequests } from "/lib/finance-port.js";

export async function runEvaluator(ns: NS, evaluator: PurchaseEvaluator): Promise<void> {
  ns.disableLog("ALL");
  const requests = evaluator.getRequests(ns);

  // Sende das Paket IMMER (auch wenn requests [] leer ist!).
  // Das aktualisiert den Heartbeat [✓] im Dashboard, selbst wenn nichts zu kaufen ist.
  submitPurchaseRequests(ns, evaluator.category, requests);
}