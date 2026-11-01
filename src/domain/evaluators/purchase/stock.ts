// lib/evaluators/stock.ts
import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchaseCategory,
  PurchasePriority,
} from "/shared/types/finance.js";
import { runEvaluator } from "../evaluator-runner.js";
import { loadBnMults, isStockViable } from "/lib/utils.js";
import { PATHS } from "/infrastructure/runtime/paths";
import {
  CASH_BUFFER,
  STOCK_TRADE_MARGIN,
} from "/shared/constants/finance.js";
import { loadFinanceState } from "/infrastructure/state/state.js";
import {
  getStockTradingBudget,
  STOCK_LONG_ENTRY_FORECAST,
  STOCK_SHORT_ENTRY_FORECAST,
  shouldExitStockPosition,
} from "./stock-runtime.js";

const STOCK_TRADE_BUDGET_RATIO = 0.2;

export const StockEvaluator: PurchaseEvaluator = {
  category: "STOCK_LICENSE" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    const requests: PurchaseRequest[] = [];
    
    // 🔴 1. Viability Check
    if (!isStockViable(ns)) return requests;

    const bnMults = loadBnMults(ns);
    const fourSigmaApiCostMult = bnMults.FourSigmaMarketDataApiCost ?? 1.0;

    const tixCost = 5_000_000_000;
    const fourSigmaTixCost = 25_000_000_000 * fourSigmaApiCostMult;

    const playerMoney = ns.getServerMoneyAvailable("home");

    // TIX API works without a WSE account; 4S API is the only market data required.
    const canAffordSafely = (cost: number) => playerMoney >= cost * 3.33;

    if (!ns.stock.hasTixApiAccess()) {
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
    } else if (!ns.stock.has4SDataTixApi()) {
      if (canAffordSafely(fourSigmaTixCost) || playerMoney >= fourSigmaTixCost * 1.2) {
        requests.push({
          id: "stock-4s-tix-api",
          category: "STOCK_LICENSE" as PurchaseCategory,
          priority: PurchasePriority.HIGH,
          score: 90,
          cost: fourSigmaTixCost,
          description: `4S TIX API (Forecast) [Mult: ${fourSigmaApiCostMult.toFixed(2)}x]`,
          action: {
            script: PATHS.app.actions.stock,
            args: ["stock-purchase-license", "4s-tix"],
          },
        });
      }
    }

    if (!ns.stock.has4SDataTixApi()) return requests;

    const symbols = ns.stock.getSymbols();

    const buyCandidates: {
      sym: string;
      forecast: number;
      type: "LONG" | "SHORT";
      strength: number;
    }[] = [];

    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const [shares, , sharesShort] = ns.stock.getPosition(sym);

      if (shares > 0 && shouldExitStockPosition("LONG", forecast)) {
        requests.push({
          id: `stock-exit-${sym}-LONG`,
          category: "STOCK_TRADE" as PurchaseCategory,
          priority: PurchasePriority.HIGH,
          score: Math.round((0.5 - forecast) * 100),
          cost: 0,
          description: `Aktien-Ausstieg: ${sym} LONG [Forecast: ${(forecast * 100).toFixed(1)}%]`,
          action: {
            script: PATHS.app.actions.stock,
            args: ["stock-sell", sym, "LONG", shares],
          },
        });
      }

      if (sharesShort > 0 && shouldExitStockPosition("SHORT", forecast)) {
        requests.push({
          id: `stock-exit-${sym}-SHORT`,
          category: "STOCK_TRADE" as PurchaseCategory,
          priority: PurchasePriority.HIGH,
          score: Math.round((forecast - 0.5) * 100),
          cost: 0,
          description: `Aktien-Ausstieg: ${sym} SHORT [Forecast: ${(forecast * 100).toFixed(1)}%]`,
          action: {
            script: PATHS.app.actions.stock,
            args: ["stock-sell", sym, "SHORT", sharesShort],
          },
        });
      }

      if (shares === 0 && sharesShort === 0) {
        if (forecast > STOCK_LONG_ENTRY_FORECAST) {
          buyCandidates.push({
            sym,
            forecast,
            type: "LONG",
            strength: forecast - 0.5,
          });
        } else if (forecast < STOCK_SHORT_ENTRY_FORECAST) {
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

    const configuredReserve = loadFinanceState(ns)?.moneyReserve ?? 0;
    const reserve = Math.max(
      CASH_BUFFER,
      Number.isFinite(configuredReserve) && configuredReserve > 0
        ? configuredReserve
        : 0,
    );
    const availableMoney = Math.max(0, playerMoney - reserve);
    const remainingBudget = getStockTradingBudget(
      availableMoney,
      STOCK_TRADE_BUDGET_RATIO,
      STOCK_TRADE_MARGIN,
    );
    let budgetLeft = remainingBudget;

    if (budgetLeft > 0) {
      for (const candidate of buyCandidates.slice(0, 2)) {
        const sym = candidate.sym;
        const maxShares = Math.floor(ns.stock.getMaxShares(sym));
        const positionType = candidate.type === "LONG" ? "L" : "S";
        let low = 1;
        let high = maxShares;
        let affordableShares = 0;
        let targetCost = 0;

        while (low <= high) {
          const shares = Math.floor((low + high) / 2);
          const cost = ns.stock.getPurchaseCost(sym, shares, positionType);
          if (Number.isFinite(cost) && cost > 0 && cost <= budgetLeft) {
            affordableShares = shares;
            targetCost = cost;
            low = shares + 1;
          } else {
            high = shares - 1;
          }
        }

        if (affordableShares > 0) {
          budgetLeft -= targetCost;
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