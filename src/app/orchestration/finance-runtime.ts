import type { NS } from "@ns";

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

export const BN8_SLEEVE_AUG_UNLOCK_MONEY = 100_000_000_000_000;
export const BN8_VIOLET_CONGRUITY_RESERVE = 150_000_000_000_000;

const BN8_POST_RED_PILL_DAEMONS = [
  "app/orchestration/sys-orchestrator.js",
  "app/orchestration/finance-core.js",
  "services/daemons/finance-dispatcher.js",
  "services/daemons/hacking-orchestrator.js",
  "services/daemons/backdoor.js",
] as const;

export function getBn8PostRedPillRamRequirement(ns: NS): number {
  let requiredRam = 0;
  for (const script of BN8_POST_RED_PILL_DAEMONS) {
    const scriptRam = ns.getScriptRam(script, "home");
    if (!Number.isFinite(scriptRam) || scriptRam <= 0) {
      return Number.POSITIVE_INFINITY;
    }
    requiredRam += scriptRam;
  }
  return requiredRam;
}

export function shouldPrepareBn8PostRedPillCapacity(
  currentNode: number,
  hasUninstalledRedPill: boolean,
  homeMaxRam: number,
  requiredRam: number,
): boolean {
  return (
    currentNode === 8 &&
    hasUninstalledRedPill &&
    Number.isFinite(homeMaxRam) &&
    Number.isFinite(requiredRam) &&
    homeMaxRam < requiredRam
  );
}

export function isBn8PostRedPillRamReady(
  currentNode: number,
  homeMaxRam: number,
  requiredRam: number,
): boolean {
  return (
    currentNode !== 8 ||
    (Number.isFinite(homeMaxRam) &&
      Number.isFinite(requiredRam) &&
      homeMaxRam >= requiredRam)
  );
}

export function shouldUnlockBn8SleeveAugPurchases(
  currentNode: number,
  hasFourSigmaLicenses: boolean,
  hasSleeves: boolean,
  money: number,
  alreadyUnlocked: boolean,
): boolean {
  return (
    currentNode === 8 &&
    (alreadyUnlocked ||
      hasFourSigmaLicenses &&
      hasSleeves &&
      Number.isFinite(money) &&
      money >= BN8_SLEEVE_AUG_UNLOCK_MONEY)
  );
}

export function shouldPrepareBn8SleeveCapacity(
  currentNode: number,
  hasFourSigmaLicenses: boolean,
  sleeveAugPurchasesUnlocked: boolean,
  hasSleeves: boolean,
  sleeveEvaluatorRunning: boolean,
  sleeveEvaluatorRam: number,
  freeHomeRam: number,
): boolean {
  return (
    currentNode === 8 &&
    hasFourSigmaLicenses &&
    sleeveAugPurchasesUnlocked &&
    hasSleeves &&
    !sleeveEvaluatorRunning &&
    Number.isFinite(sleeveEvaluatorRam) &&
    sleeveEvaluatorRam > 0 &&
    Number.isFinite(freeHomeRam) &&
    freeHomeRam < sleeveEvaluatorRam
  );
}

export function getBn8VioletGraftingReserve(
  shouldReserveViolet: boolean,
  violetCongruityOwned: boolean,
  graftPrice = BN8_VIOLET_CONGRUITY_RESERVE,
): number {
  return shouldReserveViolet && !violetCongruityOwned
    ? Number.isFinite(graftPrice) && graftPrice > 0
      ? graftPrice
      : BN8_VIOLET_CONGRUITY_RESERVE
    : 0;
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
  hasFourSigmaLicenses = false,
  hasInstalledRedPill = false,
  allowBn8HomeRamUpgrade = false,
  allowBn8SleeveAugments = false,
): boolean {
  return (
    bitNode !== 8 ||
    category === "STOCK_LICENSE" ||
    category === "STOCK_TRADE" ||
    category === "PURCHASED_SERVER" ||
    (category === "HOME_SERVER" && allowBn8HomeRamUpgrade) ||
    (category === "PLAYER_AUG" && hasFourSigmaLicenses) ||
    (category === "SLEEVE_AUG" &&
      hasFourSigmaLicenses &&
      allowBn8SleeveAugments) ||
    (category === "DARKNET_PROGRAM" && hasInstalledRedPill)
  );
}

export function shouldPrepareBn8GraftingCapacity(
  currentNode: number,
  sourceFile10Level: number,
  hasFourSigmaTixApi: boolean,
  graftingManagerRunning: boolean,
  graftingManagerRam: number,
  freeHomeRam: number,
): boolean {
  return (
    currentNode === 8 &&
    sourceFile10Level > 0 &&
    hasFourSigmaTixApi &&
    !graftingManagerRunning &&
    Number.isFinite(graftingManagerRam) &&
    graftingManagerRam > 0 &&
    Number.isFinite(freeHomeRam) &&
    freeHomeRam < graftingManagerRam
  );
}

export function isFinanceCategoryAllowedDuringAugmentation(
  category: string,
  bitNode: number,
  allowBn8HomeRamUpgrade = false,
): boolean {
  return (
    category === "SLEEVE_AUG" ||
    category === "GANG_EQUIPMENT" ||
    (bitNode === 8 &&
      (category === "STOCK_LICENSE" ||
        category === "STOCK_TRADE" ||
        category === "PLAYER_AUG" ||
        (category === "HOME_SERVER" && allowBn8HomeRamUpgrade)))
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
