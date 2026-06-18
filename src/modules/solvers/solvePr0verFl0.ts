import { NS } from "@ns";

/**
 * Solver für Pr0verFl0 - Hebelt das System durch einen simulierten Buffer Overflow aus.
 */
export async function solvePr0verFl0(
  ns: NS,
  details: any,
): Promise<string | null> {
  const len = details.passwordLength;

  // Sicherheitscheck aus dem Original: Verhindert Abstürze (RangeError), falls len fehlt
  if (!len) {
    ns.tprint("🔴 [Pr0verFl0] Fehler: Ungültige oder fehlende Passwortlänge.");
    return null;
  }

  return "A".repeat(len * 2);
}
