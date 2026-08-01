import { NS } from "@ns";
import { PurchaseRequest } from "/lib/types/finance.js";

export const FINANCE_PORT = 10;

export function submitPurchaseRequests(ns: NS, requests: PurchaseRequest[]): void {
  const port = ns.getPortHandle(FINANCE_PORT);
  for (const req of requests) {
    try {
      port.write(JSON.stringify(req));
    } catch {
      ns.print(`[FINANCE-PORT] Konnte Kaufanfrage nicht auf Port ${FINANCE_PORT} schreiben: ${req.id}`);
    }
  }
}
