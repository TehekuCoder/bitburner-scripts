import { NS } from "@ns";

/**
 * Solver für BaseConversion - Konvertiert eine Zahl von einer gegebenen Basis in das Dezimalsystem.
 */
export async function solveBaseConversion(ns: NS, details: any): Promise<string | null> {
  const parts = (details.data || "").split(",");
  
  if (parts.length !== 2) {
    ns.tprint(`🔴 [BaseConversion] Fehler: Ungültiges Datenformat (erwartet 'Basis,Wert'): ${details.data}`);
    return null;
  }

  // parts[0] ist die Basis (z.B. "16"), parts[1] ist der Wert (z.B. "FF")
  const base = parseInt(parts[0], 10);
  const valueStr = parts[1].trim();

  // Konvertierung in eine Base-10 Ganzzahl
  const decimalValue = parseInt(valueStr, base);

  // Sicherheitsprüfung, falls die Konvertierung fehlschlägt
  if (isNaN(decimalValue)) {
    ns.tprint(`🔴 [BaseConversion] Fehler: Konvertierung fehlgeschlagen für Basis ${base} und Wert ${valueStr}`);
    return null;
  }

  return decimalValue.toString();
}