import type { BatchStrategy } from "/shared/types/batcher.js";

export interface HackingStrategyOverride {
  strategy: BatchStrategy;
  reason: string;
}

export function canRunHackingWorkersOnHome(currentNode: number): boolean {
  return currentNode !== 8;
}

export function getHackingStrategyOverride(
  currentNode: number,
): HackingStrategyOverride | null {
  if (currentNode !== 8) return null;

  return {
    strategy: "WORKER",
    reason: "BN8: Worker-Fleet für Hacking-XP; Geld-Batching deaktiviert.",
  };
}
