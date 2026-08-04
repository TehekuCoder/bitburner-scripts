import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  if (!ns.stock) return;
  const action = String(ns.args[0] ?? "");

  switch (action) {
    case "stock-purchase-license": {
      const license = String(ns.args[1] ?? "");
      if (license === "wse") ns.stock.purchaseWseAccount();
      else if (license === "tix") ns.stock.purchaseTixApi();
      else if (license === "4s") ns.stock.purchase4SMarketData();
      else if (license === "4s-tix") ns.stock.purchase4SMarketDataTixApi();
      break;
    }

    case "stock-buy": {
      const symbol = String(ns.args[1] ?? "");
      const type = String(ns.args[2] ?? "LONG");
      const requestedShares = Number(ns.args[3] ?? 0);

      const sharePrice = type === "LONG" ? ns.stock.getAskPrice(symbol) : ns.stock.getBidPrice(symbol);
      const maxShares = ns.stock.getMaxShares(symbol);
      const [heldLong, , heldShort] = ns.stock.getPosition(symbol);
      const roomToBuy = maxShares - (type === "LONG" ? heldLong : heldShort);

      if (roomToBuy <= 0) break;

      let sharesToBuy = 0;

      if (requestedShares > 0) {
        // Explizit vom Evaluator vorgegebene Menge (gedeckelt durch das Markt-Limit)
        sharesToBuy = Math.min(requestedShares, roomToBuy);
      } else {
        // Fallback: Dynamische Berechnung aus Barmitteln
        const currentMoney = ns.getServerMoneyAvailable("home");
        const fee = 100_000;
        
        // Nur kaufen, wenn das Budget deutlich über der Transaktionsgebühr liegt
        if (currentMoney > fee * 10) {
          sharesToBuy = Math.min(roomToBuy, Math.floor((currentMoney - fee) / sharePrice));
        }
      }

      if (sharesToBuy > 0) {
        if (type === "LONG") {
          const boughtPrice = ns.stock.buyStock(symbol, sharesToBuy);
          if (boughtPrice > 0) {
            ns.print(`[Stock] Gekauft: ${ns.format.number(sharesToBuy)}x ${symbol} LONG @ $${ns.format.number(boughtPrice)}`);
          }
        } else if (type === "SHORT") {
          try {
            const boughtPrice = ns.stock.buyShort(symbol, sharesToBuy);
            if (boughtPrice > 0) {
              ns.print(`[Stock] Gekauft: ${ns.format.number(sharesToBuy)}x ${symbol} SHORT @ $${ns.format.number(boughtPrice)}`);
            }
          } catch {
            ns.print(`[Stock] Short-Positionen für ${symbol} derzeit nicht möglich.`);
          }
        }
      }
      break;
    }

    case "stock-sell": {
      const symbol = String(ns.args[1] ?? "");
      const type = String(ns.args[2] ?? "LONG");
      const [heldLong, , heldShort] = ns.stock.getPosition(symbol);

      if (type === "LONG" && heldLong > 0) {
        const soldPrice = ns.stock.sellStock(symbol, heldLong);
        if (soldPrice > 0) {
          ns.print(`[Stock] Verkauft: ${ns.format.number(heldLong)}x ${symbol} LONG @ $${ns.format.number(soldPrice)}`);
        }
      } else if (type === "SHORT" && heldShort > 0) {
        try {
          const soldPrice = ns.stock.sellShort(symbol, heldShort);
          if (soldPrice > 0) {
            ns.print(`[Stock] Verkauft: ${ns.format.number(heldShort)}x ${symbol} SHORT @ $${ns.format.number(soldPrice)}`);
          }
        } catch {
          ns.print(`[Stock] Fehler beim Schließen der Short-Position für ${symbol}.`);
        }
      }
      break;
    }
  }
}