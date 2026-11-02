import assert from "node:assert/strict";
import test from "node:test";
import {
  BITNODE_8_STOCK_TRADE_BUDGET_RATIO,
  DEFAULT_STOCK_TRADE_BUDGET_RATIO,
  ESTIMATED_STOCK_MIN_SAMPLES,
  estimateStockForecast,
  getStockTradeBudgetRatio,
  getStockCashReserve,
  getStockTradingBudget,
  isStockPositionProfitableAfterFees,
  isStockInfluenceRamConstrained,
  meetsStockMinimumInvestment,
  parseStockPriceHistory,
  updateStockPriceHistory,
  STOCK_LONG_ENTRY_FORECAST,
  STOCK_SHORT_ENTRY_FORECAST,
  shouldExitStockPosition,
  shouldInfluenceStockPosition,
} from "../src/domain/evaluators/purchase/stock-runtime.ts";
import { isStockFinanceActionAllowed } from "../src/app/orchestration/finance-runtime.ts";

test("BitNode 8 allocates a larger stock trading budget than the default", () => {
  assert.equal(getStockTradeBudgetRatio(8), BITNODE_8_STOCK_TRADE_BUDGET_RATIO);
  assert.equal(getStockTradeBudgetRatio(7), DEFAULT_STOCK_TRADE_BUDGET_RATIO);
});

test("stock exits require a clear opposite signal", () => {
  assert.equal(shouldExitStockPosition("LONG", STOCK_SHORT_ENTRY_FORECAST), true);
  assert.equal(shouldExitStockPosition("LONG", 0.41), false);
  assert.equal(shouldExitStockPosition("SHORT", STOCK_LONG_ENTRY_FORECAST), true);
  assert.equal(shouldExitStockPosition("SHORT", 0.59), false);
  assert.equal(shouldExitStockPosition("LONG", Number.NaN), false);
});

test("stock influence follows aligned positions and keeps a wider active band", () => {
  assert.equal(shouldInfluenceStockPosition("LONG", 0.6, false), false);
  assert.equal(shouldInfluenceStockPosition("LONG", 0.61, false), true);
  assert.equal(shouldInfluenceStockPosition("SHORT", 0.39, false), true);
  assert.equal(shouldInfluenceStockPosition("LONG", 0.51, true), true);
  assert.equal(shouldInfluenceStockPosition("SHORT", 0.49, true), true);
  assert.equal(shouldInfluenceStockPosition("LONG", 0.5, true), false);
  assert.equal(shouldInfluenceStockPosition("SHORT", Number.NaN, true), false);
});

test("stock budget applies its allocation ratio once", () => {
  assert.equal(getStockTradingBudget(1000, 0.8), 800);
  assert.equal(getStockTradingBudget(1000, 0), 0);
  assert.equal(getStockTradingBudget(-100, 0.8), 0);
});

test("stock orders below the minimum investment are rejected", () => {
  assert.equal(meetsStockMinimumInvestment(4_999_999, 5_000_000), false);
  assert.equal(meetsStockMinimumInvestment(5_000_000, 5_000_000), true);
  assert.equal(meetsStockMinimumInvestment(Number.NaN, 5_000_000), false);
});

test("stock server expansion starts only when worker RAM cannot fit a script", () => {
  assert.equal(isStockInfluenceRamConstrained(1.69, 1.7), true);
  assert.equal(isStockInfluenceRamConstrained(1.7, 1.7), false);
  assert.equal(isStockInfluenceRamConstrained(Number.NaN, 1.7), false);
});

test("BN8 keeps a small cash reserve while other BitNodes keep the default", () => {
  assert.equal(getStockCashReserve(8, 2_000_000, 250_000), 250_000);
  assert.equal(getStockCashReserve(7, 2_000_000, 250_000), 2_000_000);
});

test("stock exits require profit after both transaction fees", () => {
  assert.equal(
    isStockPositionProfitableAfterFees("LONG", 100, 1_000, 3_000, 100_000),
    true,
  );
  assert.equal(
    isStockPositionProfitableAfterFees("LONG", 100, 1_000, 2_999, 100_000),
    false,
  );
  assert.equal(
    isStockPositionProfitableAfterFees("SHORT", 100, 3_000, 1_000, 100_000),
    true,
  );
  assert.equal(
    isStockPositionProfitableAfterFees("SHORT", 100, 3_000, 1_001, 100_000),
    false,
  );
  assert.equal(
    isStockPositionProfitableAfterFees("LONG", 0, 100, 200, 100_000),
    false,
  );
});

test("pre-4S price history samples only price changes and expires old samples", () => {
  const history = parseStockPriceHistory("", 100);
  const baseline = updateStockPriceHistory(history, { ECP: 100 }, 1000, 10000);
  assert.equal(baseline.history.symbols.ECP.samples.length, 0);

  const unchanged = updateStockPriceHistory(
    baseline.history,
    { ECP: 100 },
    2000,
    10000,
  );
  assert.equal(unchanged.changed, false);

  const moved = updateStockPriceHistory(
    unchanged.history,
    { ECP: 101 },
    3000,
    10000,
  );
  assert.deepEqual(moved.history.symbols.ECP.samples, [
    { direction: 1, timestamp: 3000 },
  ]);

  const expired = updateStockPriceHistory(
    moved.history,
    { ECP: 101 },
    15000,
    10000,
  );
  assert.deepEqual(expired.history.symbols.ECP.samples, []);
});

test("pre-4S estimated forecast waits for enough samples and counts direction", () => {
  const samples = Array.from({ length: ESTIMATED_STOCK_MIN_SAMPLES }, (_, i) => ({
    direction: i < 9 ? 1 : -1,
    timestamp: i,
  }));
  assert.equal(estimateStockForecast(samples.slice(0, -1)), null);
  assert.equal(estimateStockForecast(samples), 0.75);
  assert.equal(shouldExitStockPosition("LONG", 0.5, 0.5), true);
  assert.equal(shouldExitStockPosition("SHORT", 0.5, 0.5), true);
});

test("stock finance actions are routed to narrowly scoped scripts", () => {
  const routes = {
    tixLicense: "tix.js",
    fourSigmaDataLicense: "4s-data.js",
    fourSigmaLicense: "four-sigma.js",
    buyLong: "buy-long.js",
    buyShort: "buy-short.js",
    sellLong: "sell-long.js",
    sellShort: "sell-short.js",
  };
  assert.equal(
    isStockFinanceActionAllowed(
      "STOCK_LICENSE",
      ["stock-purchase-license", "tix"],
      "tix.js",
      routes,
    ),
    true,
  );
  assert.equal(
    isStockFinanceActionAllowed(
      "STOCK_LICENSE",
      ["stock-purchase-license", "4s"],
      "4s-data.js",
      routes,
    ),
    true,
  );
  assert.equal(
    isStockFinanceActionAllowed(
      "STOCK_TRADE",
      ["stock-buy", "ECP", "SHORT", 10],
      "buy-short.js",
      routes,
    ),
    true,
  );
  assert.equal(
    isStockFinanceActionAllowed(
      "STOCK_TRADE",
      ["stock-sell", "ECP", "SHORT", 10],
      "sell-long.js",
      routes,
    ),
    false,
  );
});
