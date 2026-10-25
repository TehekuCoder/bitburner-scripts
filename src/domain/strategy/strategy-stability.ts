export function shouldContinueFactionReputation(input: {
  previousMode: string | undefined;
  previousFaction: string | undefined;
  nextFaction: string | undefined;
  playerFactions: readonly string[];
  currentReputation: number;
  targetReputation: number;
}): boolean {
  return (
    input.previousMode === "REP" &&
    input.previousFaction !== undefined &&
    input.previousFaction === input.nextFaction &&
    input.playerFactions.includes(input.previousFaction) &&
    Number.isFinite(input.currentReputation) &&
    Number.isFinite(input.targetReputation) &&
    input.currentReputation < input.targetReputation
  );
}
