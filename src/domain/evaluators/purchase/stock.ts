// lib/evaluators/stock.ts
import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchaseCategory,
  PurchasePriority,
} from "/shared/types/finance.js";
import { TRANSACTION_FEE } from "../../../shared/constants/finance.js";
import { runEvaluator } from "../evaluator-runner.js";
import { loadBnMults, adjustPriorityByMult, isStockViable } from "/lib/utils.js";
import { PATHS } from "/infrastructure/runtime/paths";

export const StockEvaluator: PurchaseEvaluator = {
  category: "STOCK_LICENSE" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    const requests: PurchaseRequest[] = [];
    
    // 🔴 1. Viability Check
    if (!isStockViable(ns)) return requests;

    const bnMults = loadBnMults(ns);
    const fourSigmaCostMult = bnMults.FourSigmaMarketDataCost ?? 1.0;
    const fourSigmaApiCostMult = bnMults.FourSigmaMarketDataApiCost ?? 1.0;

    const wseCost = 200_000_000;
    const tixCost = 5_000_000_000;
    const fourSigmaDataCost = 1_000_000_000 * fourSigmaCostMult;
    const fourSigmaTixCost = 25_000_000_000 * fourSigmaApiCostMult;

    const playerMoney = ns.getServerMoneyAvailable("home");

    // --- 2. LIZENZEN VERWALTEN MIT DYNAMISCHER PRIO ---
    let fullyUnlocked = true;

    // Hilfsfunktion: Eine Lizenz sollte uns nicht komplett pleite machen (max. 30% des Vermögens)
    const canAffordSafely = (cost: number) => playerMoney >= cost * 3.33;

    if (!ns.stock.hasWseAccount()) {
      fullyUnlocked = false;
      if (canAffordSafely(wseCost)) {
        requests.push({
          id: "stock-wse-account",
          category: "STOCK_LICENSE" as PurchaseCategory,
          priority: PurchasePriority.LOW,
          score: 40,
          cost: wseCost,
          description: "Börsenzugang (WSE)",
          action: {
            script: PATHS.app.actions.stock,
            args: ["stock-purchase-license", "wse"],
          },
        });
      }
    } else if (!ns.stock.hasTixApiAccess()) {
      fullyUnlocked = false;
      // TIX API erst kaufen, wenn wir uns auch der 4S-Schwelle nähern (~20B+ Vermögen)
      if (playerMoney >= 20_000_000_000) {
        requests.push({
          id: "stock-tix-api",
          category: "STOCK_LICENSE" as PurchaseCategory,
          priority: playerMoney >= 35_000_000_000 ? PurchasePriority.HIGH : PurchasePriority.MEDIUM,
          score: 60,
          cost: tixCost,
          description: "TIX API (Börsen-Automatisierung)",
          action: {
            script: PATHS.app.actions.stock,
            args: ["stock-purchase-license", "tix"],
          },
        });
      }
    } else if (!ns.stock.has4SData()) {
      fullyUnlocked = false;
      if (canAffordSafely(fourSigmaDataCost)) {
        requests.push({
          id: "stock-4s-data",
          category: "STOCK_LICENSE" as PurchaseCategory,
          priority: PurchasePriority.MEDIUM,
          score: 70,
          cost: fourSigmaDataCost,
          description: `4S Marktdaten (Forecast) [Mult: ${fourSigmaCostMult.toFixed(2)}x]`,
          action: {
            script: PATHS.app.actions.stock,
            args: ["stock-purchase-license", "4s"],
          },
        });
      }
    } else if (!ns.stock.has4SDataTixApi()) {
      fullyUnlocked = false;
      // Sobald wir 4S Data haben, ist 4S TIX API der finale Baustein -> HIGH Priority, wenn bezahlbar
      if (canAffordSafely(fourSigmaTixCost) || playerMoney >= fourSigmaTixCost * 1.2) {
        requests.push({
          id: "stock-4s-tix-api",
          category: "STOCK_LICENSE" as PurchaseCategory,
          priority: PurchasePriority.HIGH,
          score: 90,
          cost: fourSigmaTixCost,
          description: `4S TIX API (Forecast Automatisierung) [Mult: ${fourSigmaApiCostMult.toFixed(2)}x]`,
          action: {
            script: PATHS.app.actions.stock,
            args: ["stock-purchase-license", "4s-tix"],
          },
        });
      }
    }

    // Ohne Lizenzen keine Trading-Kaufanträge stellen
    if (!fullyUnlocked) return requests;

    // --- 3. TRADING FEATURE CHECK & KAUFANFRAGEN ---
    const symbols = ns.stock.getSymbols();
    let canShort = true;
    try {
      ns.stock.buyShort(symbols[0], 0);
    } catch {
      canShort = false;
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
        if (forecast > 0.6) {
          buyCandidates.push({
            sym,
            forecast,
            type: "LONG",
            strength: forecast - 0.5,
          });
        } else if (canShort && forecast < 0.4) {
          buyCandidates.push({
            sym,
            forecast,
            type: "SHORT",
            strength: 0.5 - forecast,
          });
        }
      }
    }

    buyCandidates.sort((a, b) => b.strength - a.strength);

    const tradeBudget = playerMoney * 0.2;

    if (tradeBudget > TRANSACTION_FEE * 10) {
      for (const candidate of buyCandidates.slice(0, 2)) {
        const sym = candidate.sym;
        const maxShares = ns.stock.getMaxShares(sym);
        const sharePrice =
          candidate.type === "LONG"
            ? ns.stock.getAskPrice(sym)
            : ns.stock.getBidPrice(sym);

        const affordableShares = Math.min(
          maxShares,
          Math.floor((tradeBudget - TRANSACTION_FEE) / sharePrice),
        );

        if (affordableShares > 0) {
          const targetCost = affordableShares * sharePrice + TRANSACTION_FEE;
          const score = Math.floor(candidate.strength * 100);

          const priority =
            candidate.strength > 0.25
              ? PurchasePriority.MEDIUM
              : PurchasePriority.LOW;

          requests.push({
            id: `stock-invest-${sym}-${candidate.type}`,
            category: "STOCK_TRADE" as PurchaseCategory,
            priority,
            score,
            cost: targetCost,
            description: `Aktien-Kauf: ${sym} (${candidate.type}) [Forecast: ${(candidate.forecast * 100).toFixed(1)}%]`,
            action: {
              script: PATHS.app.actions.stock,
              args: ["stock-buy", sym, candidate.type, affordableShares],
            },
          });
        }
      }
    }

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, StockEvaluator);
}