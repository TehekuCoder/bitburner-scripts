export const STOCK_SHORT_ENTRY_FORECAST = 0.4;
export const STOCK_LONG_ENTRY_FORECAST = 0.6;
export const ESTIMATED_STOCK_SHORT_ENTRY_FORECAST = 0.35;
export const ESTIMATED_STOCK_LONG_ENTRY_FORECAST = 0.65;
export const ESTIMATED_STOCK_HISTORY_LIMIT = 20;
export const ESTIMATED_STOCK_MIN_SAMPLES = 12;
export const DEFAULT_STOCK_TRADE_BUDGET_RATIO = 0.2;
export const BITNODE_8_STOCK_TRADE_BUDGET_RATIO = 0.8;
export const STOCK_PRICE_HISTORY_FILE = "stock-price-history.txt";

export interface StockPriceSample {
  direction: -1 | 1;
  timestamp: number;
}

export interface StockPriceHistoryEntry {
  lastPrice: number;
  samples: StockPriceSample[];
}

export interface StockPriceHistory {
  version: 1;
  lastAugReset: number;
  symbols: Record<string, StockPriceHistoryEntry>;
}

export interface StockPriceHistoryUpdate {
  history: StockPriceHistory;
  changed: boolean;
}

export function parseStockPriceHistory(
  serialized: string,
  lastAugReset: number,
): StockPriceHistory {
  if (!serialized) {
    return { version: 1, lastAugReset, symbols: {} };
  }

  const parsed: unknown = JSON.parse(serialized);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    parsed.version !== 1 ||
    !("lastAugReset" in parsed) ||
    parsed.lastAugReset !== lastAugReset ||
    !("symbols" in parsed) ||
    typeof parsed.symbols !== "object" ||
    parsed.symbols === null ||
    Array.isArray(parsed.symbols)
  ) {
    return { version: 1, lastAugReset, symbols: {} };
  }

  const symbols: Record<string, StockPriceHistoryEntry> = {};
  for (const [symbol, rawEntry] of Object.entries(parsed.symbols)) {
    if (
      typeof rawEntry !== "object" ||
      rawEntry === null ||
      !("lastPrice" in rawEntry) ||
      typeof rawEntry.lastPrice !== "number" ||
      !Number.isFinite(rawEntry.lastPrice) ||
      rawEntry.lastPrice <= 0 ||
      !("samples" in rawEntry) ||
      !Array.isArray(rawEntry.samples)
    ) {
      continue;
    }

    const samples = rawEntry.samples.filter(
      (sample: unknown): sample is StockPriceSample =>
        typeof sample === "object" &&
        sample !== null &&
        "direction" in sample &&
        (sample.direction === -1 || sample.direction === 1) &&
        "timestamp" in sample &&
        typeof sample.timestamp === "number" &&
        Number.isFinite(sample.timestamp),
    );
    symbols[symbol] = {
      lastPrice: rawEntry.lastPrice,
      samples: samples.slice(-ESTIMATED_STOCK_HISTORY_LIMIT),
    };
  }

  return { version: 1, lastAugReset, symbols };
}

export function updateStockPriceHistory(
  history: StockPriceHistory,
  prices: Readonly<Record<string, number>>,
  now: number,
  maxAgeMs: number,
): StockPriceHistoryUpdate {
  const symbols: Record<string, StockPriceHistoryEntry> = {};
  let changed = false;

  for (const [symbol, price] of Object.entries(prices)) {
    if (!Number.isFinite(price) || price <= 0) continue;

    const previous = history.symbols[symbol];
    if (!previous) {
      symbols[symbol] = { lastPrice: price, samples: [] };
      changed = true;
      continue;
    }

    const samples = previous.samples.filter(
      (sample) => now - sample.timestamp <= maxAgeMs,
    );
    if (samples.length !== previous.samples.length) changed = true;

    if (price !== previous.lastPrice) {
      samples.push({
        direction: price > previous.lastPrice ? 1 : -1,
        timestamp: now,
      });
      changed = true;
    }

    symbols[symbol] = {
      lastPrice: price,
      samples: samples.slice(-ESTIMATED_STOCK_HISTORY_LIMIT),
    };
  }

  if (Object.keys(symbols).length !== Object.keys(history.symbols).length) {
    changed = true;
  }

  return {
    history: { version: 1, lastAugReset: history.lastAugReset, symbols },
    changed,
  };
}

export function estimateStockForecast(
  samples: readonly StockPriceSample[],
  minimumSamples: number = ESTIMATED_STOCK_MIN_SAMPLES,
): number | null {
  if (samples.length < minimumSamples) return null;
  const upMoves = samples.reduce(
    (count, sample) => count + (sample.direction > 0 ? 1 : 0),
    0,
  );
  return upMoves / samples.length;
}

export function shouldExitStockPosition(
  type: "LONG" | "SHORT",
  forecast: number,
  threshold: number = type === "LONG"
    ? STOCK_SHORT_ENTRY_FORECAST
    : STOCK_LONG_ENTRY_FORECAST,
): boolean {
  if (!Number.isFinite(forecast) || !Number.isFinite(threshold)) return false;
  return type === "LONG"
    ? forecast <= threshold
    : forecast >= threshold;
}

export function getStockCashReserve(
  bitNode: number,
  defaultReserve: number,
  bitNode8Reserve: number,
): number {
  return bitNode === 8 ? bitNode8Reserve : defaultReserve;
}

export function isStockPositionProfitableAfterFees(
  type: "LONG" | "SHORT",
  shares: number,
  averagePrice: number,
  liquidationPrice: number,
  commission: number,
): boolean {
  if (
    !Number.isFinite(shares) ||
    shares <= 0 ||
    !Number.isFinite(averagePrice) ||
    averagePrice <= 0 ||
    !Number.isFinite(liquidationPrice) ||
    liquidationPrice <= 0 ||
    !Number.isFinite(commission) ||
    commission < 0
  ) {
    return false;
  }

  const priceProfit =
    type === "LONG"
      ? (liquidationPrice - averagePrice) * shares
      : (averagePrice - liquidationPrice) * shares;
  return priceProfit >= commission * 2;
}

export function getStockTradingBudget(
  availableMoney: number,
  budgetRatio: number,
): number {
  if (
    !Number.isFinite(availableMoney) ||
    !Number.isFinite(budgetRatio) ||
    budgetRatio <= 0
  ) {
    return 0;
  }
  return Math.max(0, availableMoney) * budgetRatio;
}

export function getStockTradeBudgetRatio(bitNode: number): number {
  return bitNode === 8
    ? BITNODE_8_STOCK_TRADE_BUDGET_RATIO
    : DEFAULT_STOCK_TRADE_BUDGET_RATIO;
}
