import type { NS, Multipliers } from "@ns";

export const BN8_DAEDALUS_BASE_AUGMENTATION_REQUIREMENT = 30;
export const BN8_VIOLET_CONGRUITY_AUGMENTATION =
  "violet Congruity Implant";
export const BN8_VIOLET_CONGRUITY_GRAFT_PRICE = 150_000_000_000_000;

const HACKING_MULTIPLIERS = [
  "hacking",
  "hacking_exp",
  "hacking_chance",
  "hacking_speed",
  "hacking_money",
  "hacking_grow",
] as const satisfies readonly (keyof Multipliers)[];

export function hasHackingAugmentationBenefit(
  stats: Partial<Multipliers>,
): boolean {
  return getHackingAugmentationValue(stats) > 0;
}

export function getHackingAugmentationValue(
  stats: Partial<Multipliers>,
): number {
  return HACKING_MULTIPLIERS.reduce((value, key) => {
    const multiplier = stats[key];
    return typeof multiplier === "number" &&
      Number.isFinite(multiplier) &&
      multiplier > 1
      ? value + Math.log(multiplier)
      : value;
  }, 0);
}

export function getDaedalusAugmentationRequirement(
  requirementMultiplier: number,
): number {
  const multiplier = Number.isFinite(requirementMultiplier)
    ? requirementMultiplier
    : 1;
  return Math.floor(
    BN8_DAEDALUS_BASE_AUGMENTATION_REQUIREMENT * multiplier,
  );
}

export function getMissingDaedalusAugmentationCount(
  requirement: number,
  installedCount: number,
  purchasedUninstalledCount: number,
): number {
  return Math.max(
    0,
    requirement - installedCount - purchasedUninstalledCount,
  );
}

export function canPurchaseBn8RedPill(
  installedCount: number,
  requirement: number,
  graftingUnlocked: boolean,
  violetCongruityInstalled: boolean,
): boolean {
  return (
    installedCount >= requirement &&
    (!graftingUnlocked || violetCongruityInstalled)
  );
}

export function shouldPrioritizeVioletCongruityGraft(
  hasJoinedDaedalus: boolean,
  violetCongruityOwned: boolean,
): boolean {
  return hasJoinedDaedalus && !violetCongruityOwned;
}

export function hasBothFourSigmaLicenses(ns: NS): boolean {
  return Boolean(
    ns.stock?.has4SData() && ns.stock.has4SDataTixApi(),
  );
}

export function hasGraftingUnlock(ns: NS): boolean {
  if (ns.getResetInfo().currentNode === 10) return true;
  return (ns.getResetInfo().ownedSF.get(10) ?? 0) > 0;
}
