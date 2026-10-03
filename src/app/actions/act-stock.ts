import { NS } from "@ns";
import { TRANSACTION_FEE } from "../../shared/constants/finance.js";
import { runTrackedFinanceAction } from "./finance-action.js";

export async function main(ns: NS): Promise<void> {
  await runTrackedFinanceAction(ns, async () => {
    if (!ns.stock) return false;
    const action = String(ns.args[0] ?? "");

    switch (action) {
      case "stock-purchase-license": {
        const license = String(ns.args[1] ?? "");
        let success = false;

        if (license === "wse") success = ns.stock.purchaseWseAccount();
        else if (license === "tix") success = ns.stock.purchaseTixApi();
        else if (license === "4s") success = ns.stock.purchase4SMarketData();
        else if (license === "4s-tix") success = ns.stock.purchase4SMarketDataTixApi();

        if (success) {
          ns.toast(`[Stock] Lizenz erworben: ${license.toUpperCase()}`, "success");
        }
        return success;
      }

      case "stock-buy": {
        const symbol = String(ns.args[1] ?? "");
        const type = String(ns.args[2] ?? "LONG");
        const requestedShares = Number(ns.args[3] ?? 0);
        const sharePrice =
          type === "LONG"
            ? ns.stock.getAskPrice(symbol)
            : ns.stock.getBidPrice(symbol);
        if (sharePrice <= 0) return false;

        const maxShares = ns.stock.getMaxShares(symbol);
        const [heldLong, , heldShort] = ns.stock.getPosition(symbol);
        const roomToBuy = maxShares - (type === "LONG" ? heldLong : heldShort);
        if (roomToBuy <= 0) return false;

        let sharesToBuy = 0;
        if (requestedShares > 0) {
          sharesToBuy = Math.min(requestedShares, roomToBuy);
        } else {
          const currentMoney = ns.getServerMoneyAvailable("home");
          if (currentMoney > TRANSACTION_FEE * 10) {
            sharesToBuy = Math.min(
              roomToBuy,
              Math.floor((currentMoney - TRANSACTION_FEE) / sharePrice),
            );
          }
        }
        if (sharesToBuy <= 0) return false;

        if (type === "LONG") {
          const boughtPrice = ns.stock.buyStock(symbol, sharesToBuy);
          if (boughtPrice <= 0) return false;
          ns.print(
            `[Stock] Gekauft: ${ns.format.number(sharesToBuy)}x ${symbol} LONG @ $${ns.format.number(boughtPrice)}`,
          );
          return true;
        }

        if (type === "SHORT") {
          try {
            const boughtPrice = ns.stock.buyShort(symbol, sharesToBuy);
            if (boughtPrice <= 0) return false;
            ns.print(
              `[Stock] Gekauft: ${ns.format.number(sharesToBuy)}x ${symbol} SHORT @ $${ns.format.number(boughtPrice)}`,
            );
            return true;
          } catch (error) {
            ns.print(`[Stock] Short-Positionen für ${symbol} derzeit nicht möglich: ${error}`);
            return false;
          }
        }
        return false;
      }

      case "stock-sell": {
        const symbol = String(ns.args[1] ?? "");
        const type = String(ns.args[2] ?? "LONG");
        const requestedShares = Number(ns.args[3] ?? 0);
        const [heldLong, , heldShort] = ns.stock.getPosition(symbol);

        if (type === "LONG" && heldLong > 0) {
          const sharesToSell =
            requestedShares > 0 ? Math.min(requestedShares, heldLong) : heldLong;
          const soldPrice = ns.stock.sellStock(symbol, sharesToSell);
          if (soldPrice <= 0) return false;
          ns.print(
            `[Stock] Verkauft: ${ns.format.number(sharesToSell)}x ${symbol} LONG @ $${ns.format.number(soldPrice)}`,
          );
          return true;
        }

        if (type === "SHORT" && heldShort > 0) {
          try {
            const sharesToSell =
              requestedShares > 0 ? Math.min(requestedShares, heldShort) : heldShort;
            const soldPrice = ns.stock.sellShort(symbol, sharesToSell);
            if (soldPrice <= 0) return false;
            ns.print(
              `[Stock] Verkauft: ${ns.format.number(sharesToSell)}x ${symbol} SHORT @ $${ns.format.number(soldPrice)}`,
            );
            return true;
          } catch (error) {
            ns.print(`[Stock] Fehler beim Schließen der Short-Position für ${symbol}: ${error}`);
            return false;
          }
        }
        return false;
      }

      default:
        return false;
    }
  });
}
