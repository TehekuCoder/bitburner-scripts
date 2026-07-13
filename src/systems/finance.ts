import { NS } from "@ns";
import { loadState, saveState } from "../core/state-manager.js";
import { Logger } from "../core/logger.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  
  // Zentralen Logger initialisieren
  const logger = new Logger(ns, "FINANCE", "INFO", "/logs/finance.txt");
  logger.info("⚡ Finanz-Subsystem v3.4 [DYNAMIC-FLEX] initialisiert.");

  let fullyUnlocked = false;
  let canShort = true; 

  const TRANSACTION_FEE = 100_000;
  const MIN_INVESTMENT = 5_000_000;
  const CASH_BUFFER = 2_000_000;

  while (true) {
    const symbols = ns.stock.getSymbols();

    // --- 1. LIZENZ-VERWALTUNG & CAPABILITY-PROBE ---
    if (!fullyUnlocked) {
      let unlocked = true;
      if (!ns.stock.hasWseAccount())
        ns.stock.purchaseWseAccount()
          ? logger.success("WSE Konto erworben.")
          : (unlocked = false);
      if (unlocked && !ns.stock.hasTixApiAccess())
        ns.stock.purchaseTixApi()
          ? logger.success("TIX API freigeschaltet.")
          : (unlocked = false);
      if (unlocked && !ns.stock.has4SData())
        ns.stock.purchase4SMarketData()
          ? logger.success("4S Marktdaten aktiv.")
          : (unlocked = false);
      if (unlocked && !ns.stock.has4SDataTixApi())
        ns.stock.purchase4SMarketDataTixApi()
          ? logger.success("4S TIX API voll lizenziert.")
          : (unlocked = false);

      fullyUnlocked = unlocked;

      if (!fullyUnlocked) {
        logger.info("⏳ Warte auf ausreichend Kapital für vollständige API-Lizenzen (60s Sleep)...");
        await ns.sleep(60000);
        continue;
      }

      logger.success("🚀 Portfolio-Manager voll einsatzbereit. Starte Marktüberwachung.");
    }

    const state = loadState(ns);
    if (state && (state as any).tradingActive !== true) {
      (state as any).tradingActive = true;
      saveState(ns, state);
    }

    // --- 2. PHASE 1: EXISTIERENDE POSITIONEN LIQUIDIEREN ---
    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const [shares, avgPrice, sharesShort, avgPriceShort] = ns.stock.getPosition(sym);

      if (shares > 0 && forecast < 0.5) {
        const priceSold = ns.stock.sellStock(sym, shares);
        if (priceSold > 0) {
          const profit = (priceSold - avgPrice) * shares - TRANSACTION_FEE;
          logger.success(`[EXIT LONG] ${sym} | Profit: $${ns.format.number(profit, 2)}`);
        }
      }

      if (canShort && sharesShort > 0 && forecast > 0.5) {
        const priceSoldShort = ns.stock.sellShort(sym, sharesShort);
        if (priceSoldShort > 0) {
          const profit = (avgPriceShort - priceSoldShort) * sharesShort - TRANSACTION_FEE;
          logger.success(`[EXIT SHORT] ${sym} | Profit: $${ns.format.number(profit, 2)}`);
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
      const maxShares = ns.stock.getMaxShares(sym);
      const sharePrice = candidate.type === "LONG" ? ns.stock.getAskPrice(sym) : ns.stock.getBidPrice(sym);

      let sharesToBuy = Math.floor((availableBudget - TRANSACTION_FEE) / sharePrice);
      sharesToBuy = Math.min(sharesToBuy, maxShares);

      if (sharesToBuy > 0) {
        if (candidate.type === "LONG") {
          const pricePaid = ns.stock.buyStock(sym, sharesToBuy);
          if (pricePaid > 0) {
            logger.info(`📈 [ENTER LONG] ${sym} (${(candidate.forecast * 100).toFixed(0)}%) | ${ns.format.number(sharesToBuy)} Units`);
          }
        } else if (candidate.type === "SHORT" && canShort) {
          try {
            const pricePaidShort = ns.stock.buyShort(sym, sharesToBuy);
            if (pricePaidShort > 0) {
              logger.info(`📉 [ENTER SHORT] ${sym} (${(candidate.forecast * 100).toFixed(0)}%) | ${ns.format.number(sharesToBuy)} Units`);
            }
          } catch (error) {
            canShort = false;
            logger.warn("ℹ️ Short-Selling nicht unterstützt/erlaubt. Schalte permanent auf [LONG-ONLY MODE].");
          }
        }
      }
    }

    await ns.sleep(6000);
  }
}