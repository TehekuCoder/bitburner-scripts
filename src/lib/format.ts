/** Formatiert Sekunden in ein lesbares Format (z.B. "1m 15s" oder "45s") */
export function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s < 10 ? "0" : ""}${s}s`;
}