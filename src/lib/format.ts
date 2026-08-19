/**
 * Fügt einer Zahl führende Nullen hinzu (z.B. 1 -> "01", 2 -> "02").
 * @param num Die zu formatierende Zahl
 * @param length Gewünschte Ziel-Länge (Standard: 2)
 */
export function padZero(num: number, length = 2): string {
  return Math.floor(Math.max(0, num)).toString().padStart(length, "0");
}

/** Formatiert Sekunden in ein lesbares Format (z.B. "1m 15s" oder "45s") */
export function formatTime(seconds: number): string {
  const totalSeconds = Math.floor(Math.max(0, seconds));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${padZero(s)}s`;
}