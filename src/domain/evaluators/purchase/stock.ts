// lib/evaluators/stock.ts
import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchaseCategory,
  PurchasePriority,
} from "/shared/types/finance.js";
import { runEvaluator } from "../evaluator-runner.js";
import { isStockViable } from "/lib/utils.js";
import { PATHS } from "/infrastructure/runtime/paths";
import { CASH_BUFFER } from "/shared/constants/finance.js";
import { loadFinanceState } from "/infrastructure/state/state.js";
import {
  ESTIMATED_STOCK_LONG_ENTRY_FORECAST,
  ESTIMATED_STOCK_MIN_SAMPLES,
  ESTIMATED_STOCK_SHORT_ENTRY_FORECAST,
  STOCK_PRICE_HISTORY_FILE,
  getStockTradeBudgetRatio,
  getStockTradingBudget,
  estimateStockForecast,
  parseStockPriceHistory,
  STOCK_LONG_ENTRY_FORECAST,
  STOCK_SHORT_ENTRY_FORECAST,
  shouldExitStockPosition,
  updateStockPriceHistory,
} from "./stock-runtime.js";

export const StockEvaluator: PurchaseEvaluator = {
  category: "STOCK_LICENSE" as PurchaseCategory,

  async getRequests(ns: NS): Promise<PurchaseRequest[]> {
    const requests: PurchaseRequest[] = [];
    const isBitNode8 = ns.getResetInfo().currentNode === 8;
    if (!ns.stock || (!isBitNode8 && !isStockViable(ns))) return requests;

    const stockConstants = ns.stock.getConstants();
    const tixCost = stockConstants.TixApiCost;
    const fourSigmaTixCost = stockConstants.MarketDataTixApi4SCost;
    const playerMoney = ns.getServerMoneyAvailable("home");
    const availableMoney = Math.max(0, playerMoney - CASH_BUFFER);

    if (!ns.stock.hasTixApiAccess()) {
      if (availableMoney >= tixCost) {
        requests.push({
          id: "stock-tix-api",
          category: "STOCK_LICENSE" as PurchaseCategory,
          priority: PurchasePriority.HIGH,
          score: 60,
          cost: tixCost,
          description: "TIX API (Börsen-Automatisierung)",
          action: {
            script: PATHS.app.actions.stockTixLicense,
            args: ["stock-purchase-license", "tix"],
          },
        });
      }
      return requests;
    }

    const hasFourSigmaApi = ns.stock.has4SDataTixApi();
    if (!hasFourSigmaApi) {
      if (availableMoney >= fourSigmaTixCost * 1.2) {
        requests.push({
          id: "stock-4s-tix-api",
          category: "STOCK_LICENSE" as PurchaseCategory,
          priority: PurchasePriority.HIGH,
          score: 90,
          cost: fourSigmaTixCost,
          description: "4S TIX API (Forecast)",
          action: {
            script: PATHS.app.actions.stockFourSigmaLicense,
            args: ["stock-purchase-license", "4s-tix"],
          },
        });
      }
    }
    if (!hasFourSigmaApi && !isBitNode8) return requests;

    const symbols = ns.stock.getSymbols();
    let estimatedForecasts: Map<string, number> | null = null;
    if (!hasFourSigmaApi) {
      const resetInfo = ns.getResetInfo();
      let history;
      try {
        history = parseStockPriceHistory(
          ns.read(STOCK_PRICE_HISTORY_FILE),
          resetInfo.lastAugReset,
        );
      } catch (error) {
        ns.print(
          `[STOCK] Kursverlauf konnte nicht gelesen werden; starte neue Schätzung: ${String(error)}`,
        );
        history = parseStockPriceHistory("", resetInfo.lastAugReset);
      }

      const prices = Object.fromEntries(
        symbols.map((symbol) => [symbol, ns.stock.getAskPrice(symbol)]),
      );
      const tickCycleMs =
        stockConstants.msPerStockUpdateMin * stockConstants.TicksPerCycle;
      const maxHistoryAgeMs =
        Number.isFinite(tickCycleMs) && tickCycleMs > 0
          ? tickCycleMs
          : 450_000;
      const update = updateStockPriceHistory(
        history,
        prices,
        Date.now(),
        maxHistoryAgeMs,
      );
      if (update.changed) {
        ns.write(
          STOCK_PRICE_HISTORY_FILE,
          JSON.stringify(update.history),
          "w",
        );
      }

      estimatedForecasts = new Map(
        Object.entries(update.history.symbols)
          .map(([symbol, entry]) => [
            symbol,
            estimateStockForecast(entry.samples, ESTIMATED_STOCK_MIN_SAMPLES),
          ] as const)
          .filter(
            (entry): entry is readonly [string, number] => entry[1] !== null,
          ),
      );
    }

    const buyCandidates: {
      sym: string;
      forecast: number;
      type: "LONG" | "SHORT";
      strength: number;
      estimated: boolean;
    }[] = [];

    for (const sym of symbols) {
      const forecast = hasFourSigmaApi
        ? ns.stock.getForecast(sym)
        : estimatedForecasts?.get(sym);
      if (forecast === undefined) continue;
      const [shares, , sharesShort] = ns.stock.getPosition(sym);
      const exitThreshold = hasFourSigmaApi ? undefined : 0.5;

      if (
        shares > 0 &&
        shouldExitStockPosition("LONG", forecast, exitThreshold)
      ) {
        requests.push({
          id: `stock-exit-${sym}-LONG`,
          category: "STOCK_TRADE" as PurchaseCategory,
          priority: PurchasePriority.HIGH,
          score: Math.round((0.5 - forecast) * 100),
          cost: 0,
          description: `Aktien-Ausstieg: ${sym} LONG [${hasFourSigmaApi ? "Forecast" : "Schätzung"}: ${(forecast * 100).toFixed(1)}%]`,
          action: {
            script: PATHS.app.actions.stockSellLong,
            args: ["stock-sell", sym, "LONG", shares],
          },
        });
      }

      if (
        sharesShort > 0 &&
        shouldExitStockPosition("SHORT", forecast, exitThreshold)
      ) {
        requests.push({
          id: `stock-exit-${sym}-SHORT`,
          category: "STOCK_TRADE" as PurchaseCategory,
          priority: PurchasePriority.HIGH,
          score: Math.round((forecast - 0.5) * 100),
          cost: 0,
          description: `Aktien-Ausstieg: ${sym} SHORT [${hasFourSigmaApi ? "Forecast" : "Schätzung"}: ${(forecast * 100).toFixed(1)}%]`,
          action: {
            script: PATHS.app.actions.stockSellShort,
            args: ["stock-sell", sym, "SHORT", sharesShort],
          },
        });
      }

      if (shares === 0 && sharesShort === 0) {
        const longEntryThreshold = hasFourSigmaApi
          ? STOCK_LONG_ENTRY_FORECAST
          : ESTIMATED_STOCK_LONG_ENTRY_FORECAST;
        const shortEntryThreshold = hasFourSigmaApi
          ? STOCK_SHORT_ENTRY_FORECAST
          : ESTIMATED_STOCK_SHORT_ENTRY_FORECAST;
        if (forecast > longEntryThreshold) {
          buyCandidates.push({
            sym,
            forecast,
            type: "LONG",
            strength: forecast - 0.5,
            estimated: !hasFourSigmaApi,
          });
        } else if (forecast < shortEntryThreshold) {
          buyCandidates.push({
            sym,
            forecast,
            type: "SHORT",
            strength: 0.5 - forecast,
            estimated: !hasFourSigmaApi,
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
    const tradingMoney = Math.max(0, playerMoney - reserve);
    const remainingBudget = getStockTradingBudget(
      tradingMoney,
      getStockTradeBudgetRatio(ns.getResetInfo().currentNode),
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
            description: `Aktien-Kauf: ${sym} (${candidate.type}) [${candidate.estimated ? "Schätzung" : "Forecast"}: ${(candidate.forecast * 100).toFixed(1)}%]`,
            action: {
              script:
                candidate.type === "LONG"
                  ? PATHS.app.actions.stockBuyLong
                  : PATHS.app.actions.stockBuyShort,
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