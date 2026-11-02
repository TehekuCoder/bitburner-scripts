export interface FinanceRequestLike {
  id: string;
  category: string;
  priority: number;
  score?: number;
  cost: number;
}

export interface FinanceProcessLike {
  filename: string;
  args: readonly unknown[];
  pid: number;
}

export interface StockFinanceActionRoutes {
  tixLicense: string;
  fourSigmaDataLicense: string;
  fourSigmaLicense: string;
  buyLong: string;
  buyShort: string;
  sellLong: string;
  sellShort: string;
}

export function isStockFinanceActionAllowed(
  category: string,
  args: readonly unknown[],
  script: string,
  routes: StockFinanceActionRoutes,
): boolean {
  let expectedScript: string | undefined;

  if (category === "STOCK_LICENSE" && args[0] === "stock-purchase-license") {
    expectedScript =
      args[1] === "tix"
        ? routes.tixLicense
        : args[1] === "4s"
          ? routes.fourSigmaDataLicense
          : args[1] === "4s-tix"
            ? routes.fourSigmaLicense
            : undefined;
  } else if (category === "STOCK_TRADE") {
    if (args[0] === "stock-buy" && args[2] === "LONG") {
      expectedScript = routes.buyLong;
    } else if (args[0] === "stock-buy" && args[2] === "SHORT") {
      expectedScript = routes.buyShort;
    } else if (args[0] === "stock-sell" && args[2] === "LONG") {
      expectedScript = routes.sellLong;
    } else if (args[0] === "stock-sell" && args[2] === "SHORT") {
      expectedScript = routes.sellShort;
    }
  }

  return expectedScript === script;
}

export function isFinanceCategoryAllowedInBitNode(
  category: string,
  bitNode: number,
): boolean {
  return (
    bitNode !== 8 ||
    category === "STOCK_LICENSE" ||
    category === "STOCK_TRADE" ||
    category === "PURCHASED_SERVER"
  );
}

export function compareFinanceRequests(
  a: FinanceRequestLike,
  b: FinanceRequestLike,
  categoryWeights: Readonly<Record<string, number>>,
): number {
  if (a.priority !== b.priority) return a.priority - b.priority;

  const weightA = categoryWeights[a.category] ?? 0;
  const weightB = categoryWeights[b.category] ?? 0;
  if (weightA !== weightB) return weightB - weightA;

  const scoreA = a.score ?? 0;
  const scoreB = b.score ?? 0;
  if (scoreA !== scoreB) return scoreB - scoreA;

  return a.cost - b.cost;
}

export function canAffordFinanceRequest(
  availableMoney: number,
  cost: number,
  margin: number,
): boolean {
  return availableMoney >= cost * margin;
}

export function getAffordableAugmentationShortlist<
  T extends FinanceRequestLike,
>(
  requests: readonly T[],
  availableMoney: number,
  margin: number,
  maxItems: number,
): T[] {
  const augmentationRequests = requests.filter(
    (request) => request.category === "PLAYER_AUG",
  );
  const affordableRequests = augmentationRequests.filter((request) =>
    canAffordFinanceRequest(availableMoney, request.cost, margin),
  );
  if (affordableRequests.length > 0) {
    return affordableRequests.slice(0, Math.max(0, maxItems));
  }

  const cheapestRequest = augmentationRequests.reduce<T | undefined>(
    (cheapest, request) =>
      !cheapest || request.cost < cheapest.cost ? request : cheapest,
    undefined,
  );
  return cheapestRequest ? [cheapestRequest] : [];
}

export function isFinanceActionTimedOut(
  now: number,
  startedAt: number,
  timeoutMs: number,
): boolean {
  return now - startedAt > timeoutMs;
}

export function getCompletedAugmentationPurchaseOutcome(
  isRunning: boolean,
  ownedAugmentations: readonly string[],
  augmentation: string,
): boolean | undefined {
  return isRunning ? undefined : ownedAugmentations.includes(augmentation);
}

export function isAugmentationPurchasePriceStale(
  requestCost: number,
  maximumPrice: number,
  currentPrice: number,
): boolean {
  return (
    !Number.isFinite(requestCost) ||
    !Number.isFinite(maximumPrice) ||
    !Number.isFinite(currentPrice) ||
    requestCost !== currentPrice ||
    maximumPrice !== currentPrice
  );
}

export function findRunningFinanceAction<T extends FinanceProcessLike>(
  processes: readonly T[],
  script: string,
  trackingId: string,
  argumentPrefix: string,
): T | undefined {
  const marker = `${argumentPrefix}${trackingId}`;
  return processes.find(
    (process) =>
      process.filename === script &&
      process.args[process.args.length - 1] === marker,
  );
}

export function findCachedFinanceRequest<
  T extends { id: string; category: string },
>(
  caches: Iterable<{ requests: ReadonlyMap<string, T> }>,
  trackingId: string,
): T | undefined {
  for (const cache of caches) {
    for (const request of cache.requests.values()) {
      if (`${request.category}:${request.id}` === trackingId) return request;
    }
  }
  return undefined;
}

export function pruneExpiredFinanceRetries(
  retries: Map<string, number>,
  now: number,
): void {
  for (const [trackingId, retryAt] of retries) {
    if (retryAt <= now) retries.delete(trackingId);
  }
}

export function isFinanceRequestRecentlyCompleted(
  completedRequests: Map<string, number>,
  trackingId: string,
  now: number,
): boolean {
  const completedUntil = completedRequests.get(trackingId);
  if (completedUntil === undefined) return false;
  if (completedUntil <= now) {
    completedRequests.delete(trackingId);
    return false;
  }
  return true;
}

export function hasPendingFinanceCategory(
  pending: Iterable<{ category: string }>,
  category: string,
): boolean {
  for (const action of pending) {
    if (action.category === category) return true;
  }
  return false;
}
