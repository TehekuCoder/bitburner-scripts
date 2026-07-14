import { NS } from "@ns";
import { loadState, patchState, BotState } from "../core/state-manager.js";
import { Logger } from "../core/logger.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  
  const logger = new Logger(ns, "FINANCE", "INFO", "/logs/finance.txt");
  logger.info("⚡ Finanz-Subsystem v3.5 [STATE-INTEGRATED] initialisiert.");

  let fullyUnlocked = false;
  let canShort = true; 

  const TRANSACTION_FEE = 100_000;
  const MIN_INVESTMENT = 5_000_000;
  const CASH_BUFFER = 2_000_000;

  // Cleanup-Handler für den Fall, dass das Skript beendet wird
  ns.atExit(() => {
    patchState(ns, {
      traderMode: "INACTIVE",
      traderProgress: "Inaktiv"
    });
    logger.info("Portfolio-Manager sauber beendet. State auf INACTIVE gesetzt.");
  });

  while (true) {
    const symbols = ns.stock.getSymbols();

    // --- 1. LIZENZ-VERWALTUNG & CAPABILITY-PROBE ---
    if (!fullyUnlocked) {
      let unlocked = true;
      let missingLicense = "";

      if (!ns.stock.hasWseAccount()) {
        missingLicense = "WSE Account ($100m)";
        if (ns.stock.purchaseWseAccount()) {
          logger.success("WSE Konto erworben.");
        } else {
          unlocked = false;
        }
      }
      if (unlocked && !ns.stock.hasTixApiAccess()) {
        missingLicense = "TIX API ($5b)";
        if (ns.stock.purchaseTixApi()) {
          logger.success("TIX API freigeschaltet.");
        } else {
          unlocked = false;
        }
      }
      if (unlocked && !ns.stock.has4SData()) {
        missingLicense = "4S Marktdaten ($1b)";
        if (ns.stock.purchase4SMarketData()) {
          logger.success("4S Marktdaten aktiv.");
        } else {
          unlocked = false;
        }
      }
      if (unlocked && !ns.stock.has4SDataTixApi()) {
        missingLicense = "4S TIX API ($25b)";
        if (ns.stock.purchase4SMarketDataTixApi()) {
          logger.success("4S TIX API voll lizenziert.");
        } else {
          unlocked = false;
        }
      }

      fullyUnlocked = unlocked;

      if (!fullyUnlocked) {
        // Melde dem State-Manager, dass wir noch in der Sparphase für Lizenzen sind
        patchState(ns, {
          traderMode: "EARLY",
          traderProgress: `Spare auf ${missingLicense}`
        });

        logger.info(`⏳ Warte auf ausreichend Kapital für: ${missingLicense} (60s Sleep)...`);
        await ns.sleep(60000);
        continue;
      }

      logger.success("🚀 Portfolio-Manager voll einsatzbereit. Starte Marktüberwachung.");
    }

    // --- 2. PHASE 1: EXISTIERENDE POSITIONEN LIQUIDIEREN ---
    let totalLongValue = 0;
    let totalShortValue = 0;

    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const [shares, avgPrice, sharesShort, avgPriceShort] = ns.stock.getPosition(sym);

      // Wertermittlung der laufenden Positionen für den State-Manager
      if (shares > 0) {
        totalLongValue += shares * ns.stock.getBidPrice(sym);
      }
      if (sharesShort > 0) {
        totalShortValue += sharesShort * ns.stock.getAskPrice(sym);
      }

      if (shares > 0 && forecast < 0.5) {
        const priceSold = ns.stock.sellStock(sym, shares);
        if (priceSold > 0) {
          const profit = (priceSold - avgPrice) * shares - TRANSACTION_FEE;
          logger.success(`[EXIT LONG] ${sym} | Profit: $${ns.format.number(profit, 2)}`);
          totalLongValue -= (shares * priceSold); // Direkt aus dem Live-Wert abziehen
        }
      }

      if (canShort && sharesShort > 0 && forecast > 0.5) {
        const priceSoldShort = ns.stock.sellShort(sym, sharesShort);
        if (priceSoldShort > 0) {
          const profit = (avgPriceShort - priceSoldShort) * sharesShort - TRANSACTION_FEE;
          logger.success(`[EXIT SHORT] ${sym} | Profit: $${ns.format.number(profit, 2)}`);
          totalShortValue -= (sharesShort * priceSoldShort);
        }
      }
    }

    // --- 3. PHASE 2: MARKTANALYSE & PORTFOLIO-PRIORISIERUNG ---
    const buyCandidates: { sym: string; forecast: number; type: "LONG" | "SHORT"; strength: number; }[] = [];

    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const [shares, , sharesShort] = ns.stock.getPosition(sym);

      if (shares === 0 && sharesShort === 0) {
        if (forecast > 0.6) {
          buyCandidates.push({ sym, forecast, type: "LONG", strength: forecast - 0.5 });
        }
        else if (canShort && forecast < 0.4) {
          buyCandidates.push({ sym, forecast, type: "SHORT", strength: 0.5 - forecast });
        }
      }
    }

    buyCandidates.sort((a, b) => b.strength - a.strength);

    // --- 4. PHASE 3: GEZIELTES KAPITAL-INVESTMENT ---
    for (const candidate of buyCandidates) {
      const currentMoney = ns.getPlayer().money;
      const availableBudget = currentMoney - CASH_BUFFER;

      if (availableBudget < MIN_INVESTMENT) break;

      const sym = candidate.sym;
      const [shares, , sharesShort] = ns.stock.getPosition(sym);
      const maxShares = ns.stock.getMaxShares(sym);
      
      const remainingShares = maxShares - (candidate.type === "LONG" ? shares : sharesShort);
      const sharePrice = candidate.type === "LONG" ? ns.stock.getAskPrice(sym) : ns.stock.getBidPrice(sym);

      let sharesToBuy = Math.floor((availableBudget - TRANSACTION_FEE) / sharePrice);
      sharesToBuy = Math.min(sharesToBuy, remainingShares);

      if (sharesToBuy > 0) {
        if (candidate.type === "LONG") {
          const pricePaid = ns.stock.buyStock(sym, sharesToBuy);
          if (pricePaid > 0) {
            logger.info(`📈 [ENTER LONG] ${sym} (${(candidate.forecast * 100).toFixed(0)}%) | ${ns.format.number(sharesToBuy)} Units`);
            totalLongValue += (sharesToBuy * pricePaid);
          }
        } else if (candidate.type === "SHORT" && canShort) {
          try {
            const pricePaidShort = ns.stock.buyShort(sym, sharesToBuy);
            if (pricePaidShort > 0) {
              logger.info(`📉 [ENTER SHORT] ${sym} (${(candidate.forecast * 100).toFixed(0)}%) | ${ns.format.number(sharesToBuy)} Units`);
              totalShortValue += (sharesToBuy * pricePaidShort);
            }
          } catch (error) {
            canShort = false;
            logger.warn("ℹ️ Short-Selling in diesem BitNode nicht erlaubt. Schalte permanent auf [LONG-ONLY MODE].");
          }
        }
      }
    }

    // --- 5. STATE-UPDATE (SPUR 4) ---
    // Hier füttern wir nun deine vordefinierten State-Keys
    let progressString = "Suche Signale... 👀";
    if (totalLongValue > 0 || totalShortValue > 0) {
      const parts: string[] = [];
      if (totalLongValue > 0) parts.push(`Long: $${ns.format.number(totalLongValue, 1)}`);
      if (totalShortValue > 0) parts.push(`Short: $${ns.format.number(totalShortValue, 1)}`);
      progressString = parts.join(" | ");
    }

    patchState(ns, {
      traderMode: "4S_ACTIVE",
      traderProgress: progressString
    });

    await ns.sleep(6000); // Synchronisiert mit dem 4S-Markttick
  }
}