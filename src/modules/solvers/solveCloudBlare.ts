import { NS } from "@ns";

/**
 * Solver für CloudBlare(tm) - Filtert alle Nicht-Ziffern aus den Daten heraus.
 */
export async function solveCloudBlare(ns: NS, details: any): Promise<string | null> {
  const data = details.data || "";
  const numericOnly = data.replace(/\D/g, "");

  if (!numericOnly) {
    ns.tprint("🔴 [CloudBlare(tm)] Fehler: Keine Ziffern in den Serverdaten gefunden.");
    return null;
  }

  return numericOnly;
}