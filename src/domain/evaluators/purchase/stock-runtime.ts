export const STOCK_SHORT_ENTRY_FORECAST = 0.4;
export const STOCK_LONG_ENTRY_FORECAST = 0.6;
export const DEFAULT_STOCK_TRADE_BUDGET_RATIO = 0.2;
export const BITNODE_8_STOCK_TRADE_BUDGET_RATIO = 0.8;

export function shouldExitStockPosition(
  type: "LONG" | "SHORT",
  forecast: number,
): boolean {
  if (!Number.isFinite(forecast)) return false;
  return type === "LONG"
    ? forecast <= STOCK_SHORT_ENTRY_FORECAST
    : forecast >= STOCK_LONG_ENTRY_FORECAST;
}

export function getStockTradingBudget(
  availableMoney: number,
  budgetRatio: number,
  margin: number,
): number {
  if (
    !Number.isFinite(availableMoney) ||
    !Number.isFinite(budgetRatio) ||
    budgetRatio <= 0 ||
    !Number.isFinite(margin) ||
    margin <= 0
  ) {
    return 0;
  }
  return (Math.max(0, availableMoney) * budgetRatio) / margin;
}

export function getStockTradeBudgetRatio(bitNode: number): number {
  return bitNode === 8
    ? BITNODE_8_STOCK_TRADE_BUDGET_RATIO
    : DEFAULT_STOCK_TRADE_BUDGET_RATIO;
}
