// lib/evaluators/stock.ts
import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchaseCategory,
  PurchasePriority,
} from "/shared/types/finance.js";
import { TRANSACTION_FEE } from "../../../shared/constants/finance.js";
import { runEvaluator } from "/lib/evaluator-runner.js";
import { loadBnMults, adjustPriorityByMult } from "/lib/utils.js";

export const StockEvaluator: PurchaseEvaluator = {
  category: "STOCK_LICENSE" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    const requests: PurchaseRequest[] = [];
    if (!ns.stock) return requests;

    const bnMults = loadBnMults(ns);

    const fourSigmaCostMult = bnMults.FourSigmaMarketDataCost ?? 1.0;
    const fourSigmaApiCostMult = bnMults.FourSigmaMarketDataApiCost ?? 1.0;

    const fourSigmaDataCost = 1_000_000_000 * fourSigmaCostMult;
    const fourSigmaTixCost = 25_000_000_000 * fourSigmaApiCostMult;

    // --- 1. LIZENZEN VERWALTEN ---
    let fullyUnlocked = true;

    if (!ns.stock.hasWseAccount()) {
      fullyUnlocked = false;
      requests.push({
        id: "stock-wse-account",
        category: "STOCK_LICENSE" as PurchaseCategory,
        priority: PurchasePriority.HIGH,
        score: 80,
        cost: 200_000_000,
        description: "Börsenzugang (WSE)",
        action: {
          script: "core/actions/act-stock.js",
          args: ["stock-purchase-license", "wse"],
        },
      });
    } else if (!ns.stock.hasTixApiAccess()) {
      fullyUnlocked = false;
      requests.push({
        id: "stock-tix-api",
        category: "STOCK_LICENSE" as PurchaseCategory,
        priority: PurchasePriority.HIGH,
        score: 85,
        cost: 5_000_000_000,
        description: "TIX API (Börsen-Automatisierung)",
        action: {
          script: "core/actions/act-stock.js",
          args: ["stock-purchase-license", "tix"],
        },
      });
    } else if (!ns.stock.has4SData()) {
      fullyUnlocked = false;
      const efficiencyMult =
        fourSigmaCostMult > 0 ? 1 / fourSigmaCostMult : 1.0;
      const priority = adjustPriorityByMult(
        PurchasePriority.MEDIUM,
        efficiencyMult,
      );
      const score = Math.max(1, Math.floor(70 * efficiencyMult));

      requests.push({
        id: "stock-4s-data",
        category: "STOCK_LICENSE" as PurchaseCategory,
        priority,
        score,
        cost: fourSigmaDataCost,
        description: `4S Marktdaten (Forecast) [Mult: ${fourSigmaCostMult.toFixed(2)}x]`,
        action: {
          script: "core/actions/act-stock.js",
          args: ["stock-purchase-license", "4s"],
        },
      });
    } else if (!ns.stock.has4SDataTixApi()) {
      fullyUnlocked = false;
      const efficiencyMult =
        fourSigmaApiCostMult > 0 ? 1 / fourSigmaApiCostMult : 1.0;
      const priority = adjustPriorityByMult(
        PurchasePriority.MEDIUM,
        efficiencyMult,
      );
      const score = Math.max(1, Math.floor(75 * efficiencyMult));

      requests.push({
        id: "stock-4s-tix-api",
        category: "STOCK_LICENSE" as PurchaseCategory,
        priority,
        score,
        cost: fourSigmaTixCost,
        description: `4S TIX API (Forecast Automatisierung) [Mult: ${fourSigmaApiCostMult.toFixed(2)}x]`,
        action: {
          script: "core/actions/act-stock.js",
          args: ["stock-purchase-license", "4s-tix"],
        },
      });
    }

    // Ohne Lizenzen keine Trading-Kaufanträge stellen
    if (!fullyUnlocked) return requests;

    // --- 2. TRADING FEATURE CHECK ---
    const symbols = ns.stock.getSymbols();
    let canShort = true;
    try {
      ns.stock.buyShort(symbols[0], 0);
    } catch {
      canShort = false;
    }

    // --- 3. TRADING KAUF-ANFRAGEN ---
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

    const playerMoney = ns.getServerMoneyAvailable("home");
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

          requests.push({
            id: `stock-invest-${sym}-${candidate.type}`,
            category: "STOCK_TRADE" as PurchaseCategory,
            priority: PurchasePriority.IDLE,
            score,
            cost: targetCost,
            description: `Aktien-Kauf: ${sym} (${candidate.type}) [Forecast: ${(candidate.forecast * 100).toFixed(1)}%]`,
            action: {
              script: "core/actions/act-stock.js",
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
