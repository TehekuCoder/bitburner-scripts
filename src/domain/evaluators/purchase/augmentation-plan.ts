import type { AugPurchasePlanItem } from "/shared/types/factions.js";

export function getEligibleAugmentations(
  items: readonly AugPurchasePlanItem[],
  ownedAugs: ReadonlySet<string>,
): AugPurchasePlanItem[] {
  return items.filter(
    (item) =>
      !ownedAugs.has(item.name) &&
      item.prereqs.every((prerequisite) => ownedAugs.has(prerequisite)),
  );
}

export function selectNextAugmentationRequest<
  T extends { priority: number; cost: number; description: string },
>(requests: readonly T[]): T | undefined {
  return [...requests].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.cost - b.cost ||
      a.description.localeCompare(b.description),
  )[0];
}
