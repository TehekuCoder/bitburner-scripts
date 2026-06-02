import { NS } from "@ns";

export function createProgressBar(current: number, target: number, size = 10): string {
  if (target <= 0) return `[██████████] 100.0%`;
  const percent = Math.min(1, current / target);
  const progress = Math.floor(size * percent);
  const bar = "█".repeat(progress) + "░".repeat(size - progress);
  return `[${bar}] ${(percent * 100).toFixed(1)}%`;
}