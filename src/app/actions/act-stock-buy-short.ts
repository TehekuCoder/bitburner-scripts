import { NS } from "@ns";
import { TRANSACTION_FEE } from "/shared/constants/finance.js";
import { runTrackedFinanceAction } from "./finance-action.js";

export async function main(ns: NS): Promise<void> {
  await runTrackedFinanceAction(ns, () => {
    if (!ns.stock) return false;
    const symbol = String(ns.args[1] ?? "");
    const requestedShares = Number(ns.args[3] ?? 0);
    if (!symbol || !Number.isFinite(requestedShares) || requestedShares < 0) {
      return false;
    }

    const [, , heldShort] = ns.stock.getPosition(symbol);
    const roomToBuy = ns.stock.getMaxShares(symbol) - heldShort;
    let shares = Math.min(Math.floor(requestedShares), roomToBuy);
    if (requestedShares === 0) {
      const currentMoney = ns.getServerMoneyAvailable("home");
      const sharePrice = ns.stock.getBidPrice(symbol);
      if (currentMoney > TRANSACTION_FEE * 10 && sharePrice > 0) {
        shares = Math.min(
          roomToBuy,
          Math.floor((currentMoney - TRANSACTION_FEE) / sharePrice),
        );
      }
    }
    if (shares <= 0) return false;

    try {
      const boughtPrice = ns.stock.buyShort(symbol, shares);
      if (boughtPrice <= 0) return false;
      ns.print(
        `[Stock] Gekauft: ${ns.format.number(shares)}x ${symbol} SHORT @ $${ns.format.number(boughtPrice)}`,
      );
      return true;
    } catch (error) {
      ns.print(
        `[Stock] Short-Positionen für ${symbol} derzeit nicht möglich: ${error}`,
      );
      return false;
    }
  });
}
