import { NS } from "@ns";

export async function solveBaseConversion(
  ns: NS,
  host: string,
  details: any
): Promise<string | null> {
  const rawData = String(details?.data || "").trim();
  if (!rawData) {
    ns.print("🔴 [BaseConversion] Keine Daten übergeben.");
    return null;
  }

  // Trennt bei Komma, Doppelpunkt oder Leerzeichen
  const parts = rawData.split(/[,:\s]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    ns.print(`🔴 [BaseConversion] Ungültiges Datenformat: "${rawData}"`);
    return null;
  }

  let base = 10;
  let valueStr = "";

  const p0 = parseInt(parts[0], 10);
  const p1 = parseInt(parts[1], 10);

  // Automatische Erkennung, welcher Wert die Basis ist (2, 8, 10, 16)
  if (!isNaN(p0) && [2, 8, 10, 16].includes(p0)) {
    base = p0;
    valueStr = parts[1];
  } else if (!isNaN(p1) && [2, 8, 10, 16].includes(p1)) {
    base = p1;
    valueStr = parts[0];
  } else {
    // Fallback: Erster Wert ist Basis
    base = p0;
    valueStr = parts[1];
  }

  const decimalValue = parseInt(valueStr, base);
  if (isNaN(decimalValue)) {
    ns.print(`🔴 [BaseConversion] Konnte '${valueStr}' nicht aus Basis ${base} konvertieren.`);
    return null;
  }

  const guess = decimalValue.toString();
  ns.print(`🔢 [BaseConversion] ${valueStr} (Basis ${base}) -> Dezimal: ${guess}`);

  const result = (await ns.dnet.authenticate(host, guess)) as any;
  return result?.success ? guess : null;
}