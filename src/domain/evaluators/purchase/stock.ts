// lib/evaluators/stock.ts
import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchaseCategory,
  PurchasePriority,
  StockDashboardSnapshot,
  StockDashboardSymbol,
} from "/shared/types/finance.js";
import { runEvaluator } from "../evaluator-runner.js";
import { isStockViable } from "/lib/utils.js";
import { PATHS } from "/infrastructure/runtime/paths";
import {
  BITNODE_8_CASH_BUFFER,
  CASH_BUFFER,
  MIN_INVESTMENT,
  STOCK_DASHBOARD_FILE,
} from "/shared/constants/finance.js";
import { loadFinanceState } from "/infrastructure/state/state.js";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import {
  ESTIMATED_STOCK_LONG_ENTRY_FORECAST,
  ESTIMATED_STOCK_MIN_SAMPLES,
  ESTIMATED_STOCK_SHORT_ENTRY_FORECAST,
  STOCK_PRICE_HISTORY_FILE,
  getStockCashReserve,
  getStockTradeBudgetRatio,
  getStockTradingBudget,
  estimateStockForecast,
  meetsStockMinimumInvestment,
  parseStockPriceHistory,
  STOCK_LONG_ENTRY_FORECAST,
  STOCK_SHORT_ENTRY_FORECAST,
  shouldExitStockPosition,
  updateStockPriceHistory,
} from "./stock-runtime.js";

const lastLoggedDecisions = new Map<
  string,
  { reason: string; timestamp: number }
>();
const DASHBOARD_REFRESH_INTERVAL_MS = 10_000;

function logStockDecision(
  logger: LoggerClient,
  symbol: string,
  reason: string,
): void {
  const now = Date.now();
  const previous = lastLoggedDecisions.get(symbol);
  if (
    previous?.reason === reason &&
    now - previous.timestamp < 60_000
  ) {
    return;
  }
  lastLoggedDecisions.set(symbol, { reason, timestamp: now });
  logger.info(reason, symbol, {
    tags: ["stock-decision"],
    context: { reason },
  });
}

async function writeStockDashboard(
  ns: NS,
  logger: LoggerClient,
  snapshot: Omit<StockDashboardSnapshot, "updatedAt">,
): Promise<void> {
  const content = JSON.stringify({ ...snapshot, updatedAt: 0 });
  const current = ns.read(STOCK_DASHBOARD_FILE);
  if (current) {
    try {
      const currentSnapshot = JSON.parse(current) as StockDashboardSnapshot;
      if (JSON.stringify({ ...currentSnapshot, updatedAt: 0 }) === content) {
        if (
          Date.now() - currentSnapshot.updatedAt <
          DASHBOARD_REFRESH_INTERVAL_MS
        ) {
          return;
        }
      }
    } catch (error) {
      logger.warn(`Aktien-Dashboard-Datei wird neu erstellt: ${String(error)}`);
    }
  }

  await ns.write(
    STOCK_DASHBOARD_FILE,
    JSON.stringify({ ...snapshot, updatedAt: Date.now() }),
    "w",
  );
}

export const StockEvaluator: PurchaseEvaluator = {
  category: "STOCK_LICENSE" as PurchaseCategory,

  async getRequests(ns: NS): Promise<PurchaseRequest[]> {
    const requests: PurchaseRequest[] = [];
    const logger = new LoggerClient(ns, "STOCK", undefined, "INFO");
    const isBitNode8 = ns.getResetInfo().currentNode === 8;
    if (!ns.stock) {
      const status = "Stock-API ist nicht verfügbar.";
      logger.warn(status);
      await writeStockDashboard(ns, logger, {
        mode: "LOCKED",
        status,
        tradingBudget: 0,
        samplesRequired: ESTIMATED_STOCK_MIN_SAMPLES,
        symbols: [],
      });
      return requests;
    }
    if (!isBitNode8 && !isStockViable(ns)) {
      const status = "Außerhalb BN8: 4S-Daten für Aktienhandel erforderlich.";
      logStockDecision(logger, "MARKT", status);
      await writeStockDashboard(ns, logger, {
        mode: "LOCKED",
        status,
        tradingBudget: 0,
        samplesRequired: ESTIMATED_STOCK_MIN_SAMPLES,
        symbols: [],
      });
      return requests;
    }

    const stockConstants = ns.stock.getConstants();
    const tixCost = stockConstants.TixApiCost;
    const fourSigmaDataCost = stockConstants.MarketData4SCost;
    const fourSigmaTixCost = stockConstants.MarketDataTixApi4SCost;
    const playerMoney = ns.getServerMoneyAvailable("home");
    const configuredReserve = loadFinanceState(ns)?.moneyReserve ?? 0;
    const reserve = Math.max(
      getStockCashReserve(
        ns.getResetInfo().currentNode,
        CASH_BUFFER,
        BITNODE_8_CASH_BUFFER,
      ),
      Number.isFinite(configuredReserve) && configuredReserve > 0
        ? configuredReserve
        : 0,
    );
    const availableMoney = Math.max(0, playerMoney - reserve);

    if (!ns.stock.hasTixApiAccess()) {
      const canAffordTix = availableMoney >= tixCost;
      const status = canAffordTix
        ? `TIX-Lizenz wird angefordert ($${ns.format.number(tixCost)}).`
        : `TIX-Lizenz fehlt; nach Reserve fehlen $${ns.format.number(tixCost - availableMoney)}.`;
      logStockDecision(logger, "MARKT", status);
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
      await writeStockDashboard(ns, logger, {
        mode: "LOCKED",
        status,
        tradingBudget: 0,
        samplesRequired: ESTIMATED_STOCK_MIN_SAMPLES,
        symbols: [],
      });
      return requests;
    }

    const hasFourSigmaData = ns.stock.has4SData();
    const hasFourSigmaApi = ns.stock.has4SDataTixApi();
    if (!hasFourSigmaData && availableMoney >= fourSigmaDataCost) {
      requests.push({
        id: "stock-4s-data",
        category: "STOCK_LICENSE" as PurchaseCategory,
        priority: PurchasePriority.CRITICAL,
        score: 100,
        cost: fourSigmaDataCost,
        description: "4S Market Data Access",
        action: {
          script: PATHS.app.actions.stock4sDataLicense,
          args: ["stock-purchase-license", "4s"],
        },
      });
    } else if (
      hasFourSigmaData &&
      !hasFourSigmaApi &&
      availableMoney >= fourSigmaTixCost
    ) {
      requests.push({
          id: "stock-4s-tix-api",
          category: "STOCK_LICENSE" as PurchaseCategory,
          priority: PurchasePriority.CRITICAL,
          score: 100,
          cost: fourSigmaTixCost,
          description: "4S TIX API (Forecast)",
          action: {
            script: PATHS.app.actions.stockFourSigmaLicense,
            args: ["stock-purchase-license", "4s-tix"],
          },
        });
    }
    if (!hasFourSigmaApi && !isBitNode8) {
      const status = "4S-Lizenz fehlt; ohne BN8 keine Forecast-Schätzung.";
      logStockDecision(logger, "MARKT", status);
      await writeStockDashboard(ns, logger, {
        mode: "LOCKED",
        status,
        tradingBudget: 0,
        samplesRequired: ESTIMATED_STOCK_MIN_SAMPLES,
        symbols: [],
      });
      return requests;
    }

    const symbols = ns.stock.getSymbols();
    let estimatedForecasts: Map<string, number> | null = null;
    const sampleCounts = new Map<string, number>();
    if (!hasFourSigmaApi) {
      const resetInfo = ns.getResetInfo();
      let history;
      try {
        history = parseStockPriceHistory(
          ns.read(STOCK_PRICE_HISTORY_FILE),
          resetInfo.lastAugReset,
        );
      } catch (error) {
        logger.warn(
          `Kursverlauf konnte nicht gelesen werden; starte neue Schätzung: ${String(error)}`,
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
        await ns.write(
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
      for (const [symbol, entry] of Object.entries(update.history.symbols)) {
        sampleCounts.set(symbol, entry.samples.length);
      }
    }

    const dashboardSymbols: StockDashboardSymbol[] = [];
    const dashboardBySymbol = new Map<string, StockDashboardSymbol>();
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
      if (forecast === undefined) {
        const samples = sampleCounts.get(sym) ?? 0;
        const row: StockDashboardSymbol = {
          symbol: sym,
          forecast: null,
          samples,
          longShares: 0,
          shortShares: 0,
          decision: `Warte auf Kursdaten (${samples}/${ESTIMATED_STOCK_MIN_SAMPLES})`,
        };
        dashboardSymbols.push(row);
        dashboardBySymbol.set(sym, row);
        logStockDecision(logger, sym, row.decision);
        continue;
      }
      const [shares, , sharesShort] = ns.stock.getPosition(sym);
      const row: StockDashboardSymbol = {
        symbol: sym,
        forecast,
        samples: hasFourSigmaApi ? 0 : sampleCounts.get(sym) ?? 0,
        longShares: shares,
        shortShares: sharesShort,
        decision: "Keine Position",
      };
      dashboardSymbols.push(row);
      dashboardBySymbol.set(sym, row);
      const exitThreshold = hasFourSigmaApi ? undefined : 0.5;

      if (
        shares > 0 &&
        shouldExitStockPosition("LONG", forecast, exitThreshold)
      ) {
        row.decision = "VERKAUF LONG (Gegensignal)";
        requests.push({
          id: `stock-exit-${sym}-LONG`,
          category: "STOCK_TRADE" as PurchaseCategory,
          priority: PurchasePriority.HIGH,
          score: Math.round((0.5 - forecast) * 100),
          cost: 0,
          description: `Aktien-Ausstieg: ${sym} LONG (Gegensignal; unabhängig von Gebührengewinn) [${hasFourSigmaApi ? "Forecast" : "Schätzung"}: ${(forecast * 100).toFixed(1)}%]`,
          action: {
            script: PATHS.app.actions.stockSellLong,
            args: ["stock-sell", sym, "LONG", shares],
          },
        });
        logStockDecision(
          logger,
          sym,
          `${row.decision}: Gegensignal bei Forecast ${(forecast * 100).toFixed(1)}%; Verkauf unabhängig vom Gewinn nach Gebühren.`,
        );
      }

      if (
        sharesShort > 0 &&
        shouldExitStockPosition("SHORT", forecast, exitThreshold)
      ) {
        row.decision = "VERKAUF SHORT (Gegensignal)";
        requests.push({
          id: `stock-exit-${sym}-SHORT`,
          category: "STOCK_TRADE" as PurchaseCategory,
          priority: PurchasePriority.HIGH,
          score: Math.round((forecast - 0.5) * 100),
          cost: 0,
          description: `Aktien-Ausstieg: ${sym} SHORT (Gegensignal; unabhängig von Gebührengewinn) [${hasFourSigmaApi ? "Forecast" : "Schätzung"}: ${(forecast * 100).toFixed(1)}%]`,
          action: {
            script: PATHS.app.actions.stockSellShort,
            args: ["stock-sell", sym, "SHORT", sharesShort],
          },
        });
        logStockDecision(
          logger,
          sym,
          `${row.decision}: Gegensignal bei Forecast ${(forecast * 100).toFixed(1)}%; Verkauf unabhängig vom Gewinn nach Gebühren.`,
        );
      }

      if (shares === 0 && sharesShort === 0) {
        const longEntryThreshold = hasFourSigmaApi
          ? STOCK_LONG_ENTRY_FORECAST
          : ESTIMATED_STOCK_LONG_ENTRY_FORECAST;
        const shortEntryThreshold = hasFourSigmaApi
          ? STOCK_SHORT_ENTRY_FORECAST
          : ESTIMATED_STOCK_SHORT_ENTRY_FORECAST;
        if (forecast > longEntryThreshold) {
          row.decision = "Kaufkandidat LONG";
          buyCandidates.push({
            sym,
            forecast,
            type: "LONG",
            strength: forecast - 0.5,
            estimated: !hasFourSigmaApi,
          });
        } else if (forecast < shortEntryThreshold) {
          row.decision = "Kaufkandidat SHORT";
          buyCandidates.push({
            sym,
            forecast,
            type: "SHORT",
            strength: 0.5 - forecast,
            estimated: !hasFourSigmaApi,
          });
        } else {
          row.decision = `Halten: Schwelle ${Math.round(shortEntryThreshold * 100)}-${Math.round(longEntryThreshold * 100)}%`;
        }
      } else if (row.decision === "Keine Position") {
        row.decision = shares > 0 ? "HALTEN LONG" : "HALTEN SHORT";
      }
      if (!row.decision.startsWith("Kaufkandidat") && !row.decision.startsWith("VERKAUF")) {
        logStockDecision(
          logger,
          sym,
          `${row.decision}; Forecast ${(forecast * 100).toFixed(1)}%`,
        );
      }
    }

    buyCandidates.sort((a, b) => b.strength - a.strength);

    const tradingMoney = Math.max(0, playerMoney - reserve);
    const remainingBudget = getStockTradingBudget(
      tradingMoney,
      getStockTradeBudgetRatio(ns.getResetInfo().currentNode),
    );
    let budgetLeft = remainingBudget;
    const selectedCandidates = buyCandidates.slice(0, 2);
    for (const candidate of buyCandidates.slice(2)) {
      const row = dashboardBySymbol.get(candidate.sym);
      if (row) row.decision = "Kein Kauf: nur Top 2 nach Signalstärke";
      logStockDecision(logger, candidate.sym, "Kein Kauf: nur die zwei stärksten Signale werden budgetiert.");
    }

    if (budgetLeft > 0) {
      for (const candidate of selectedCandidates) {
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

        if (
          affordableShares > 0 &&
          meetsStockMinimumInvestment(targetCost, MIN_INVESTMENT)
        ) {
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
          const row = dashboardBySymbol.get(sym);
          if (row) {
            row.decision = `ANFRAGE ${candidate.type} ${affordableShares}x`;
          }
          logStockDecision(
            logger,
            sym,
            `Kauf ${candidate.type} angefordert: ${affordableShares} Aktien für $${ns.format.number(targetCost)}.`,
          );
        } else {
          const row = dashboardBySymbol.get(sym);
          const belowMinimum =
            affordableShares > 0 &&
            !meetsStockMinimumInvestment(targetCost, MIN_INVESTMENT);
          if (row) {
            row.decision = belowMinimum
              ? `Kein Kauf: Mindestbetrag $${ns.format.number(MIN_INVESTMENT)}`
              : "Kein Kauf: Budget reicht nicht für 1 Aktie";
          }
          logStockDecision(
            logger,
            sym,
            belowMinimum
              ? `Kein Kauf: Die Orderkosten liegen unter dem Mindestbetrag von $${ns.format.number(MIN_INVESTMENT)} inklusive Gebühren.`
              : "Kein Kauf: Das verbleibende Handelsbudget reicht nicht für eine Aktie inklusive Gebühren.",
          );
        }
      }
    } else {
      for (const candidate of selectedCandidates) {
        const row = dashboardBySymbol.get(candidate.sym);
        if (row) row.decision = "Kein Kauf: Handelsbudget 0";
        logStockDecision(
          logger,
          candidate.sym,
          "Kein Kauf: kein Handelsbudget nach Abzug der Geldreserve.",
        );
      }
    }

    await writeStockDashboard(ns, logger, {
      mode: hasFourSigmaApi ? "4S" : "ESTIMATE",
      status: hasFourSigmaApi
        ? "4S-Forecast aktiv."
        : !hasFourSigmaData
          ? `BN8-Kursbewegungs-Schätzung aktiv; spare zuerst $${ns.format.number(fourSigmaDataCost)} für 4S Market Data Access.`
          : `BN8-Kursbewegungs-Schätzung aktiv; spare $${ns.format.number(fourSigmaTixCost)} für die 4S-TIX-API. Mindestens ${ESTIMATED_STOCK_MIN_SAMPLES} Kursbewegungen je Aktie.`,
      tradingBudget: remainingBudget,
      samplesRequired: ESTIMATED_STOCK_MIN_SAMPLES,
      symbols: dashboardSymbols,
    });

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, StockEvaluator);
}