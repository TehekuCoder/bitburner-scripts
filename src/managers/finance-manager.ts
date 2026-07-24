// src/systems/finance.ts

import { NS } from "@ns";
import { TRANSACTION_FEE, CASH_BUFFER, MIN_INVESTMENT } from "/lib/constants";
import { Logger } from "/lib/logger";
import { patchState } from "/lib/state";


export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  // 🛑 AUTOMATISCHER RAM-SCHUTZWALL (Early Exit)
  const homeMaxRam = ns.getServerMaxRam("home");
  const playerMoney = ns.getPlayer().money;
  const hasWse = ns.stock.hasWseAccount();

  if (!hasWse && (playerMoney < 100_000_000 || homeMaxRam < 128)) {
    // Wenn zu früh im Run: Sofort beenden und RAM freigeben!
    patchState(ns, {
      traderMode: "INACTIVE",
      traderProgress: "Warte auf $100m + 128GB RAM",
      financeProgress: "Inaktiv",
    });
    return;
  }

  const logger = new Logger(ns, "FINANCE", "INFO", "/logs/finance.txt");
  logger.info("⚡ Finanz-Subsystem aktiv. RAM-Kriterien erfüllt.");

  let fullyUnlocked = false;
  let canShort = true;
  let lastLogTime = 0;

  ns.atExit(() => {
    patchState(ns, {
      traderMode: "INACTIVE",
      traderProgress: "Inaktiv",
      financeProgress: "Inaktiv",
    });
    logger.info("Finanz-Manager sauber beendet.");
  });

  while (true) {
    // --- 1. LIZENZ-VERWALTUNG & CAPABILITY-PROBE ---
    if (!fullyUnlocked) {
      let unlocked = true;
      let missingLicense = "";

      if (!ns.stock.hasWseAccount()) {
        missingLicense = "WSE Account ($100m)";
        if (ns.stock.purchaseWseAccount())
          logger.success("WSE Konto erworben.");
        else unlocked = false;
      }
      if (unlocked && !ns.stock.hasTixApiAccess()) {
        missingLicense = "TIX API ($5b)";
        if (ns.stock.purchaseTixApi())
          logger.success("TIX API freigeschaltet.");
        else unlocked = false;
      }
      if (unlocked && !ns.stock.has4SData()) {
        missingLicense = "4S Marktdaten ($1b)";
        if (ns.stock.purchase4SMarketData())
          logger.success("4S Marktdaten aktiv.");
        else unlocked = false;
      }
      if (unlocked && !ns.stock.has4SDataTixApi()) {
        missingLicense = "4S TIX API ($25b)";
        if (ns.stock.purchase4SMarketDataTixApi())
          logger.success("4S TIX API voll lizenziert.");
        else unlocked = false;
      }

      fullyUnlocked = unlocked;

      patchState(ns, {
        traderMode: "EARLY",
        traderProgress: fullyUnlocked
          ? "Initialisiere..."
          : `Spare auf ${missingLicense}`,
        financeProgress: fullyUnlocked ? "Markt-Bereit" : "Lizenzsuche",
      });

      if (!fullyUnlocked) {
        const now = Date.now();
        if (now - lastLogTime > 60000) {
          logger.info(`⏳ Warte auf Budget für ${missingLicense}...`);
          lastLogTime = now;
        }
        await ns.sleep(6000);
        continue;
      }
      logger.success(
        "🚀 Portfolio-Manager voll einsatzbereit. Starte Marktüberwachung.",
      );
    }

    // --- 2. TRADING LOGIK (UNVERÄNDERT) ---
    const symbols = ns.stock.getSymbols();
    let totalLongValue = 0;
    let totalShortValue = 0;

    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const [shares, avgPrice, sharesShort, avgPriceShort] =
        ns.stock.getPosition(sym);

      if (shares > 0) totalLongValue += shares * ns.stock.getBidPrice(sym);
      if (sharesShort > 0)
        totalShortValue += sharesShort * ns.stock.getAskPrice(sym);

      if (shares > 0 && forecast < 0.5) {
        const priceSold = ns.stock.sellStock(sym, shares);
        if (priceSold > 0) {
          const profit = (priceSold - avgPrice) * shares - TRANSACTION_FEE;
          logger.success(
            `[EXIT LONG] ${sym} | Profit: $${ns.format.number(profit, 2)}`,
          );
          totalLongValue -= shares * priceSold;
        }
      }

      if (canShort && sharesShort > 0 && forecast > 0.5) {
        const priceSoldShort = ns.stock.sellShort(sym, sharesShort);
        if (priceSoldShort > 0) {
          const profit =
            (avgPriceShort - priceSoldShort) * sharesShort - TRANSACTION_FEE;
          logger.success(
            `[EXIT SHORT] ${sym} | Profit: $${ns.format.number(profit, 2)}`,
          );
          totalShortValue -= sharesShort * priceSoldShort;
        }
      }
    }

    const buyCandidates: {
      sym: string;
      forecast: number;
      type: "LONG" | "SHORT";
      strength: number;
    }[] = [];
    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const [shares, , sharesShort] = ns.stock.getPosition(sym);

      if (shares === 0 && sharesShort === 0) {
        if (forecast > 0.6)
          buyCandidates.push({
            sym,
            forecast,
            type: "LONG",
            strength: forecast - 0.5,
          });
        else if (canShort && forecast < 0.4)
          buyCandidates.push({
            sym,
            forecast,
            type: "SHORT",
            strength: 0.5 - forecast,
          });
      }
    }

    buyCandidates.sort((a, b) => b.strength - a.strength);

    for (const candidate of buyCandidates) {
      const currentMoney = ns.getPlayer().money;
      const availableBudget = currentMoney - CASH_BUFFER;

      if (availableBudget < MIN_INVESTMENT) break;

      const sym = candidate.sym;
      const [shares, , sharesShort] = ns.stock.getPosition(sym);
      const maxShares = ns.stock.getMaxShares(sym);

      const remainingShares =
        maxShares - (candidate.type === "LONG" ? shares : sharesShort);
      const sharePrice =
        candidate.type === "LONG"
          ? ns.stock.getAskPrice(sym)
          : ns.stock.getBidPrice(sym);

      let sharesToBuy = Math.floor(
        (availableBudget - TRANSACTION_FEE) / sharePrice,
      );
      sharesToBuy = Math.min(sharesToBuy, remainingShares);

      if (sharesToBuy > 0) {
        if (candidate.type === "LONG") {
          const pricePaid = ns.stock.buyStock(sym, sharesToBuy);
          if (pricePaid > 0) {
            logger.info(
              `📈 [ENTER LONG] ${sym} (${(candidate.forecast * 100).toFixed(0)}%) | ${ns.format.number(sharesToBuy)} Units`,
            );
            totalLongValue += sharesToBuy * pricePaid;
          }
        } else if (candidate.type === "SHORT" && canShort) {
          try {
            const pricePaidShort = ns.stock.buyShort(sym, sharesToBuy);
            if (pricePaidShort > 0) {
              logger.info(
                `📉 [ENTER SHORT] ${sym} (${(candidate.forecast * 100).toFixed(0)}%) | ${ns.format.number(sharesToBuy)} Units`,
              );
              totalShortValue += sharesToBuy * pricePaidShort;
            }
          } catch {
            canShort = false;
            logger.warn(
              "ℹ️ Short-Selling deaktiviert. Schalte permanent auf [LONG-ONLY MODE].",
            );
          }
        }
      }
    }

    let progressString = "Suche Signale... 👀";
    if (totalLongValue > 0 || totalShortValue > 0) {
      const parts: string[] = [];
      if (totalLongValue > 0)
        parts.push(`L: $${ns.format.number(totalLongValue, 1)}`);
      if (totalShortValue > 0)
        parts.push(`S: $${ns.format.number(totalShortValue, 1)}`);
      progressString = parts.join(" | ");
    }

    patchState(ns, {
      traderMode: "4S_ACTIVE",
      traderProgress: progressString,
    });

    await ns.sleep(6000);
  }
}
