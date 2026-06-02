import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.print("Finanz-Subsystem initialisiert. Prüfe Lizenzen...");

  let fullyUnlocked: boolean = false;

  while (true) {
    // --- 1. LIZENZ-VERWALTUNG ---
    if (!fullyUnlocked) {
      let unlocked: boolean = true;

      // In v3.0.0 sind die Namen der Checks und Käufe strikt vereinheitlicht
      if (!ns.stock.hasWseAccount()) {
        if (ns.stock.purchaseWseAccount()) ns.print("✅ Gekauft: WSE Account");
        else unlocked = false;
      }
      if (unlocked && !ns.stock.hasTixApiAccess()) {
        if (ns.stock.purchaseTixApi()) ns.print("✅ Gekauft: TIX API Access");
        else unlocked = false;
      }
      if (unlocked && !ns.stock.has4SData()) {
        if (ns.stock.purchase4SMarketData())
          ns.print("✅ Gekauft: 4S Market Data");
        else unlocked = false;
      }
      if (unlocked && !ns.stock.has4SDataTixApi()) {
        if (ns.stock.purchase4SMarketDataTixApi())
          ns.print("✅ Gekauft: 4S Market Data TIX API");
        else unlocked = false;
      }

      fullyUnlocked = unlocked;

      if (!fullyUnlocked) {
        // Standby, falls Kapital für Lizenzen fehlt
        await ns.sleep(60000);
        continue;
      } else {
        ns.print("Alle Börsen-APIs online! Starte Hochfrequenz-Handel...");
      }
    }

    // --- 2. HOCHFREQUENZ-HANDEL ---
    const symbols: string[] = ns.stock.getSymbols();

    for (const sym of symbols) {
      const forecast: number = ns.stock.getForecast(sym);

      // getPosition gibt immer [shares, avgPrice, sharesShort, avgPriceShort] zurück.
      // Wir definieren das Tupel explizit für TypeScript.
      const [sharesOwned, avgPrice]: [number, number, number, number] =
        ns.stock.getPosition(sym);

      // KAUFEN: Trend > 60%
      if (forecast > 0.6 && sharesOwned === 0) {
        const money: number = ns.getPlayer().money - 1000000; // 1 Mio Puffer
        if (money > 0) {
          const sharePrice: number = ns.stock.getAskPrice(sym);
          const maxShares: number = Math.floor(money / sharePrice);
          const sharesToBuy: number = Math.min(
            maxShares,
            ns.stock.getMaxShares(sym),
          );

          if (sharesToBuy > 0) {
            const pricePaid: number = ns.stock.buyStock(sym, sharesToBuy);
            if (pricePaid > 0) {
              ns.print(
                `📈 LONG ${sym}: ${sharesToBuy} Units @ $${ns.format.number(pricePaid * sharesToBuy, 2)}`,
              );
            }
          }
        }
      }

      // VERKAUFEN: Trend < 50% (Trend gekippt oder stagniert)
      else if (forecast < 0.5 && sharesOwned > 0) {
        const priceSold: number = ns.stock.sellStock(sym, sharesOwned);
        if (priceSold > 0) {
          const profit: number = (priceSold - avgPrice) * sharesOwned;
          const icon: string = profit > 0 ? "💰" : "📉";
          ns.print(
            `${icon} EXIT ${sym}: Profit ${profit >= 0 ? "" : "-"}$${ns.format.number(Math.abs(profit), 2)}`,
          );
        }
      }
    }

    // Ein Börsentick dauert ca. 6 Sekunden
    await ns.sleep(6000);
  }
}
