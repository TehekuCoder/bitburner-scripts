import type { FactionName } from "@ns";

export const BN8_FACTION_DONATION_UNLOCK_MONEY = 1_000_000_000_000_000;

export function shouldUnlockBn8FactionDonations(
  currentNode: number,
  hasSleeves: boolean,
  money: number,
  alreadyUnlocked: boolean,
): boolean {
  return (
    currentNode === 8 &&
    (alreadyUnlocked ||
      (hasSleeves &&
        Number.isFinite(money) &&
        money >= BN8_FACTION_DONATION_UNLOCK_MONEY))
  );
}

export function shouldDonateToBn8Faction(
  currentNode: number,
  faction: FactionName,
  generalDonationsUnlocked: boolean,
  canPurchaseRedPill: boolean,
): boolean {
  return (
    currentNode === 8 &&
    (generalDonationsUnlocked ||
      (faction === "Daedalus" && canPurchaseRedPill))
  );
}

export function getFactionDonationAmount(
  targetRep: number,
  currentRep: number,
  factionRepMultiplier: number,
): number {
  if (
    !Number.isFinite(targetRep) ||
    !Number.isFinite(currentRep) ||
    !Number.isFinite(factionRepMultiplier) ||
    factionRepMultiplier <= 0
  ) {
    return 0;
  }

  const repGap = Math.max(0, targetRep - currentRep);
  // One extra rep absorbs rounding at the donation API boundary.
  return repGap > 0
    ? Math.ceil(((repGap + 1) * 1_000_000) / factionRepMultiplier)
    : 0;
}

export function meetsFactionDonationFavorRequirement(
  currentNode: number,
  factionFavor: number,
  favorToDonate: number,
): boolean {
  return (
    currentNode === 8 ||
    (Number.isFinite(factionFavor) &&
      Number.isFinite(favorToDonate) &&
      factionFavor >= favorToDonate)
  );
}
