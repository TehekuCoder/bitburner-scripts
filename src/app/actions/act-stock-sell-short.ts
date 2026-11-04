import { NS } from "@ns";
import { runTrackedFinanceAction } from "./finance-action.js";

export async function main(ns: NS): Promise<void> {
  await runTrackedFinanceAction(ns, () => {
    if (!ns.stock) return false;
    const symbol = String(ns.args[1] ?? "");
    const requestedShares = Number(ns.args[3] ?? 0);
    if (!symbol) return false;

    const [, , heldShort] = ns.stock.getPosition(symbol);
    const shares =
      requestedShares > 0
        ? Math.min(Math.floor(requestedShares), heldShort)
        : heldShort;
    if (shares <= 0) return false;

    try {
      const soldPrice = ns.stock.sellShort(symbol, shares);
      if (soldPrice <= 0) return false;
      ns.print(
        `[Stock] Verkauft: ${ns.format.number(shares)}x ${symbol} SHORT @ $${ns.format.number(soldPrice)}`,
      );
      return true;
    } catch (error) {
      ns.print(
        `[Stock] Fehler beim Schließen der Short-Position für ${symbol}: ${error}`,
      );
      return false;
    }
  });
}
