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
      const sharePrice = type === "LONG" ? ns.stock.getAskPrice(symbol) : ns.stock.getBidPrice(symbol);
      const currentMoney = ns.getServerMoneyAvailable("home");
      const sharesToBuy = Math.max(0, Math.floor((currentMoney - 100000) / sharePrice));

      if (sharesToBuy > 0) {
        if (type === "LONG") {
          ns.stock.buyStock(symbol, sharesToBuy);
        } else if (type === "SHORT") {
          try { ns.stock.buyShort(symbol, sharesToBuy); } catch {}
        }
      }
      break;
    }
  }
}