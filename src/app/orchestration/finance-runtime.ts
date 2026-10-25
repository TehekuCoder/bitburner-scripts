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

export function isFinanceActionTimedOut(
  now: number,
  startedAt: number,
  timeoutMs: number,
): boolean {
  return now - startedAt > timeoutMs;
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
