import { NS } from "@ns";
import { runTrackedFinanceAction } from "./finance-action.js";
import { isStockPositionProfitableAfterFees } from "/domain/evaluators/purchase/stock-runtime.js";

export async function main(ns: NS): Promise<void> {
  await runTrackedFinanceAction(ns, () => {
    if (!ns.stock) return false;
    const symbol = String(ns.args[1] ?? "");
    const requestedShares = Number(ns.args[3] ?? 0);
    if (!symbol) return false;

    const [heldLong, averageLongPrice] = ns.stock.getPosition(symbol);
    const shares =
      requestedShares > 0
        ? Math.min(Math.floor(requestedShares), heldLong)
        : heldLong;
    if (shares <= 0) return false;
    if (
      !isStockPositionProfitableAfterFees(
        "LONG",
        shares,
        averageLongPrice,
        ns.stock.getBidPrice(symbol),
        ns.stock.getConstants().StockMarketCommission,
      )
    ) {
      ns.print(
        `[Stock] Verkauf von ${symbol} LONG abgebrochen: nach Kauf- und Verkaufsgebühr kein Gewinn.`,
      );
      return false;
    }

    const soldPrice = ns.stock.sellStock(symbol, shares);
    if (soldPrice <= 0) return false;
    ns.print(
      `[Stock] Verkauft: ${ns.format.number(shares)}x ${symbol} LONG @ $${ns.format.number(soldPrice)}`,
    );
    return true;
  });
}
