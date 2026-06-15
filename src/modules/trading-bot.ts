import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.print("⚡ Finanz-Subsystem v3.2 [PROFIT-MAX] initialisiert.");

  let fullyUnlocked = false;
  const TRANSACTION_FEE = 100_000;
  const MIN_INVESTMENT = 5_000_000; // Lohnt sich erst richtig ab 5M wegen der 100k Gebühr
  const CASH_BUFFER = 2_000_000; // Absoluter Notgroschen für Scripte/Ram

  while (true) {
    // --- 1. LIZENZ-VERWALTUNG ---
    if (!fullyUnlocked) {
      let unlocked = true;
      if (!ns.stock.hasWseAccount())
        ns.stock.purchaseWseAccount() ? ns.print("✅ WSE") : (unlocked = false);
      if (unlocked && !ns.stock.hasTixApiAccess())
        ns.stock.purchaseTixApi() ? ns.print("✅ TIX") : (unlocked = false);
      if (unlocked && !ns.stock.has4SData())
        ns.stock.purchase4SMarketData()
          ? ns.print("✅ 4S Data")
          : (unlocked = false);
      if (unlocked && !ns.stock.has4SDataTixApi())
        ns.stock.purchase4SMarketDataTixApi()
          ? ns.print("✅ 4S TIX API")
          : (unlocked = false);

      fullyUnlocked = unlocked;
      if (!fullyUnlocked) {
        await ns.sleep(60000);
        continue;
      }
      ns.print("🚀 Alle APIs aktiv. Portfolio-Manager gestartet.");
    }

    const symbols = ns.stock.getSymbols();

    // --- 2. PHASE 1: EXISTIERENDE POSITIONEN PRÜFEN & LIQUIDIEREN (CASH GENERIEREN) ---
    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const [shares, avgPrice, sharesShort, avgPriceShort] =
        ns.stock.getPosition(sym);

      // LONG-Exit: Trend vorbei oder kippt
      if (shares > 0 && forecast < 0.5) {
        const priceSold = ns.stock.sellStock(sym, shares);
        if (priceSold > 0) {
          const profit = (priceSold - avgPrice) * shares - TRANSACTION_FEE;
          ns.print(
            `💰 [EXIT LONG] ${sym} | Profit: $${ns.format.number(profit, 2)}`,
          );
        }
      }

      // SHORT-Exit: Aktie fängt sich wieder, fällt nicht mehr stark genug
      if (sharesShort > 0 && forecast > 0.5) {
        const priceSoldShort = ns.stock.sellShort(sym, sharesShort);
        if (priceSoldShort > 0) {
          const profit =
            (avgPriceShort - priceSoldShort) * sharesShort - TRANSACTION_FEE;
          ns.print(
            `📉 [EXIT SHORT] ${sym} | Profit: $${ns.format.number(profit, 2)}`,
          );
        }
      }
    }

    // --- 3. PHASE 2: MARKTANALYSE & PORTFOLIO-PRIORISIERUNG ---
    const buyCandidates: {
      sym: string;
      forecast: number;
      type: "LONG" | "SHORT";
      strength: number;
    }[] = [];

    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const [shares, , sharesShort] = ns.stock.getPosition(sym);

      // Nur analysieren, wenn wir nicht schon in die Gegenrichtung investiert sind
      if (forecast > 0.6 && shares === 0 && sharesShort === 0) {
        buyCandidates.push({
          sym,
          forecast,
          type: "LONG",
          strength: forecast - 0.5,
        });
      } else if (forecast < 0.4 && shares === 0 && sharesShort === 0) {
        buyCandidates.push({
          sym,
          forecast,
          type: "SHORT",
          strength: 0.5 - forecast,
        });
      }
    }

    // Sortiere Kandidaten nach der absoluten Stärke des Trends (stärkste zuerst!)
    buyCandidates.sort((a, b) => b.strength - a.strength);

    // --- 4. PHASE 3: GEZIELTES KAPITAL-INVESTMENT ---
    for (const candidate of buyCandidates) {
      const currentMoney = ns.getPlayer().money;
      const availableBudget = currentMoney - CASH_BUFFER;

      // Macht der Kauf wirtschaftlich Sinn?
      if (availableBudget < MIN_INVESTMENT) break;

      const sym = candidate.sym;
      const maxShares = ns.stock.getMaxShares(sym);
      const sharePrice =
        candidate.type === "LONG"
          ? ns.stock.getAskPrice(sym)
          : ns.stock.getBidPrice(sym);

      let sharesToBuy = Math.floor(
        (availableBudget - TRANSACTION_FEE) / sharePrice,
      );
      sharesToBuy = Math.min(sharesToBuy, maxShares);

      if (sharesToBuy > 0) {
        if (candidate.type === "LONG") {
          const pricePaid = ns.stock.buyStock(sym, sharesToBuy);
          if (pricePaid > 0) {
            ns.print(
              `📈 [ENTER LONG] ${sym} (Forecast: ${(candidate.forecast * 100).toFixed(0)}%) mit ${ns.format.number(sharesToBuy)} Units`,
            );
          }
        } else {
          const pricePaidShort = ns.stock.buyShort(sym, sharesToBuy);
          if (pricePaidShort > 0) {
            ns.print(
              `📉 [ENTER SHORT] ${sym} (Forecast: ${(candidate.forecast * 100).toFixed(0)}%) mit ${ns.format.number(sharesToBuy)} Units`,
            );
          }
        }
      }
    }

    await ns.sleep(6000);
  }
}
