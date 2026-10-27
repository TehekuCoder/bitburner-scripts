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
