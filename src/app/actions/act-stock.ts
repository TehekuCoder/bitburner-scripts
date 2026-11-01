import { NS } from "@ns";
import { PATHS } from "/infrastructure/runtime/paths.js";

function resolveStockAction(args: readonly unknown[]): string | null {
  const action = args[0];
  if (action === "stock-purchase-license") {
    if (args[1] === "tix") return PATHS.app.actions.stockTixLicense;
    if (args[1] === "wse") return PATHS.app.actions.stockWseLicense;
    if (args[1] === "4s") return PATHS.app.actions.stock4sDataLicense;
    if (args[1] === "4s-tix") {
      return PATHS.app.actions.stockFourSigmaLicense;
    }
  }

  if (action === "stock-buy") {
    if (args[2] === "LONG") return PATHS.app.actions.stockBuyLong;
    if (args[2] === "SHORT") return PATHS.app.actions.stockBuyShort;
  }

  if (action === "stock-sell") {
    if (args[2] === "LONG") return PATHS.app.actions.stockSellLong;
    if (args[2] === "SHORT") return PATHS.app.actions.stockSellShort;
  }

  return null;
}

export async function main(ns: NS): Promise<void> {
  const actionPath = resolveStockAction(ns.args);
  if (!actionPath) {
    ns.print("[Stock] Unbekannte Aktion.");
    return;
  }

  const pid = ns.run(actionPath, 1, ...ns.args);
  if (pid <= 0) {
    ns.print(`[Stock] Aktion konnte nicht gestartet werden: ${actionPath}`);
    return;
  }

  while (ns.isRunning(pid)) {
    await ns.sleep(50);
  }
}
