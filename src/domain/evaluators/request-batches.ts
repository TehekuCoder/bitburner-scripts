export interface CategorizedRequest {
  category: string;
}

export interface RequestBatch<T extends CategorizedRequest> {
  category: string;
  requests: T[];
}

export function groupRequestsByCategory<T extends CategorizedRequest>(
  fallbackCategory: string,
  requests: readonly T[],
): RequestBatch<T>[] {
  if (requests.length === 0) {
    return [{ category: fallbackCategory, requests: [] }];
  }

  const grouped = new Map<string, T[]>();
  for (const request of requests) {
    const categoryRequests = grouped.get(request.category) ?? [];
    categoryRequests.push(request);
    grouped.set(request.category, categoryRequests);
  }

  return Array.from(grouped, ([category, categoryRequests]) => ({
    category,
    requests: categoryRequests,
  }));
}
