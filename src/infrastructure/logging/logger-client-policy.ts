export function shouldEmitLog(
  levelRank: number,
  minimumLevelRank: number,
): boolean {
  return levelRank >= minimumLevelRank;
}

export class PortDropTracker {
  private droppedCount = 0;
  private lastWarningAt = 0;
  private readonly warningIntervalMs: number;

  constructor(warningIntervalMs: number) {
    this.warningIntervalMs = warningIntervalMs;
  }

  public record(portWriteSucceeded: boolean, now: number): number | undefined {
    if (!portWriteSucceeded) this.droppedCount++;
    if (
      this.droppedCount === 0 ||
      now - this.lastWarningAt < this.warningIntervalMs
    ) {
      return undefined;
    }

    const droppedCount = this.droppedCount;
    this.droppedCount = 0;
    this.lastWarningAt = now;
    return droppedCount;
  }
}
