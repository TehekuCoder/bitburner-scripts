import assert from "node:assert/strict";
import test from "node:test";
import {
  BITNODE_8_STOCK_TRADE_BUDGET_RATIO,
  DEFAULT_STOCK_TRADE_BUDGET_RATIO,
  getStockTradeBudgetRatio,
  getStockTradingBudget,
  STOCK_LONG_ENTRY_FORECAST,
  STOCK_SHORT_ENTRY_FORECAST,
  shouldExitStockPosition,
} from "../src/domain/evaluators/purchase/stock-runtime.ts";

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

test("stock budget reserves cash and accounts for the finance margin", () => {
  assert.equal(getStockTradingBudget(1000, 0.2, 1.5), 1000 / 7.5);
  assert.equal(getStockTradingBudget(1000, 0.2, 0), 0);
  assert.equal(getStockTradingBudget(-100, 0.2, 1.5), 0);
});
