import { NS } from "@ns";

/**
 * Solver für CloudBlare(tm) - Filtert alle Nicht-Ziffern aus den Daten heraus.
 */
export async function solveCloudBlare(
  ns: NS,
  host: string,
  details: any
): Promise<string | null> {
  const rawData = String(details?.data || "").trim();
  const numericOnly = rawData.replace(/\D/g, "");

  if (!numericOnly) {
    ns.print("🔴 [CloudBlare(tm)] Fehler: Keine Ziffern in den Serverdaten gefunden.");
    return null;
  }

  ns.print(`☁️ [CloudBlare(tm)] Extrahierte Ziffern: "${numericOnly}"`);
  return numericOnly;
}