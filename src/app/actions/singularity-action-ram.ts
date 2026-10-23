import { NS } from "@ns";

const SINGULARITY_ACTION_RAM: Record<string, number> = {
  "home-upgrade-ram": 3,
  "home-upgrade-cores": 3,
  "program-purchase-tor": 2,
  "program-purchase": 2,
  "player-purchase-aug": 5,
  "player-purchase-nfg": 7.5,
  "player-donate-faction": 5,
};

const ACTION_BASE_RAM = 1.6;
const ACTION_RAM_HEADROOM = 0.5;

export function getSingularityRamMultiplier(ns: NS): number {
  const resetInfo = ns.getResetInfo();
  if (resetInfo.currentNode === 4) return 1;

  const sourceFileLevel = resetInfo.ownedSF.get(4) ?? 0;
  if (sourceFileLevel >= 3) return 1;
  if (sourceFileLevel >= 2) return 4;
  return 16;
}

export function getSingularityActionRam(
  args: readonly (string | number)[],
  multiplier: number,
): number | undefined {
  const action = String(args[0] ?? "");
  const singularityApiRam = SINGULARITY_ACTION_RAM[action];
  if (singularityApiRam === undefined) return undefined;

  const actionRam =
    ACTION_BASE_RAM +
    singularityApiRam * multiplier +
    0.1 +
    ACTION_RAM_HEADROOM;
  return Math.ceil(actionRam * 100) / 100;
}

export function getMaximumSingularityActionRam(multiplier: number): number {
  return Math.max(
    ...Object.keys(SINGULARITY_ACTION_RAM).map(
      (action) => getSingularityActionRam([action], multiplier)!,
    ),
  );
}
