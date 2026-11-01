import { NS } from "@ns";
import { runTrackedFinanceAction } from "./finance-action.js";
import { isStockPositionProfitableAfterFees } from "/domain/evaluators/purchase/stock-runtime.js";

export async function main(ns: NS): Promise<void> {
  await runTrackedFinanceAction(ns, () => {
    if (!ns.stock) return false;
    const symbol = String(ns.args[1] ?? "");
    const requestedShares = Number(ns.args[3] ?? 0);
    if (!symbol) return false;

    const [, , heldShort, averageShortPrice] = ns.stock.getPosition(symbol);
    const shares =
      requestedShares > 0
        ? Math.min(Math.floor(requestedShares), heldShort)
        : heldShort;
    if (shares <= 0) return false;
    if (
      !isStockPositionProfitableAfterFees(
        "SHORT",
        shares,
        averageShortPrice,
        ns.stock.getAskPrice(symbol),
        ns.stock.getConstants().StockMarketCommission,
      )
    ) {
      ns.print(
        `[Stock] Verkauf von ${symbol} SHORT abgebrochen: nach Kauf- und Verkaufsgebühr kein Gewinn.`,
      );
      return false;
    }

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
