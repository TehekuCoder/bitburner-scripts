import { NS } from "@ns";

export async function solveBaseConversion(ns: NS, host: string, details: any): Promise<string | null> {
  const parts = (details.data || "").split(",");
  
  if (parts.length !== 2) {
    ns.tprint(`🔴 [BaseConversion] Fehler: Ungültiges Datenformat (erwartet 'Basis,Wert') auf ${host}: ${details.data}`);
    return null;
  }

  const base = parseInt(parts[0], 10);
  const valueStr = parts[1].trim();
  const decimalValue = parseInt(valueStr, base);

  if (isNaN(decimalValue)) {
    ns.tprint(`🔴 [BaseConversion] Fehler: Konvertierung fehlgeschlagen für Basis ${base} und Wert ${valueStr} auf ${host}`);
    return null;
  }

  return decimalValue.toString();
}