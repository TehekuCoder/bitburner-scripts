import { NS } from "@ns";
import { LoggerClient } from "/lib/logger-client.js";

export async function solveOctantVoxel(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient
): Promise<string | null> {
  const rawData = String(details?.data || "").trim();
  if (!rawData) {
    logger?.error("🔴 Keine Daten übergeben.");
    return null;
  }

  const parts = rawData.split(/[,:\s]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    logger?.error(`🔴 Ungültiges Datenformat: "${rawData}"`);
    return null;
  }

  let base = 10;
  let valueStr = "";

  const p0 = parseInt(parts[0], 10);
  const p1 = parseInt(parts[1], 10);

  if (!isNaN(p0) && [2, 8, 10, 16].includes(p0)) {
    base = p0;
    valueStr = parts[1];
  } else if (!isNaN(p1) && [2, 8, 10, 16].includes(p1)) {
    base = p1;
    valueStr = parts[0];
  } else {
    base = p0;
    valueStr = parts[1];
  }

  const decimalValue = parseInt(valueStr, base);
  if (isNaN(decimalValue)) {
    logger?.error(`🔴 Konnte '${valueStr}' nicht aus Basis ${base} konvertieren.`);
    return null;
  }

  const guess = decimalValue.toString();
  logger?.info(`🔢 ${valueStr} (Basis ${base}) -> Dezimal: ${guess}`);

  const result = (await ns.dnet.authenticate(host, guess)) as any;
  if (result?.success) {
    logger?.success(`🎉 Korrekt! Passwort: ${guess}`);
    return guess;
  }

  logger?.error(`🔴 Lösung '${guess}' abgelehnt.`);
  return null;
}