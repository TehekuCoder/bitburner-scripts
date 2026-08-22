import { NS } from "@ns";

/**
 * Zeichnet eine saubere Fortschrittsanzeige im Skript-Log.
 */
export function drawProgress(
  ns: NS,
  host: string,
  current: number,
  total: number,
  mode: string,
): void {
  const size = 15; // Breite der Bar
  const progress = Math.max(0, Math.min(1, current / total));
  const filled = Math.round(size * progress);
  const empty = size - filled;
  const bar = "■".repeat(filled) + "□".repeat(empty);
  const percent = (progress * 100).toFixed(1);

  // Überschreibt sauber die Ansicht im Log-Fenster
  ns.print(`[${mode}] ${host} -> ${bar} ${percent}% (${current}/${total})`);
}