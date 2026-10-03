import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { DnetAuthAttemptState } from "/shared/types/network.js";
import { authenticateDnet } from "/infrastructure/runtime/dnet-state.js";

export async function solveOctantVoxel(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient,
  authAttemptState?: DnetAuthAttemptState,
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
    logger?.error(`🔴 Serverwert konnte nicht aus Basis ${base} konvertiert werden.`);
    return null;
  }

  const guess = decimalValue.toString();
  logger?.info(`🔢 Serverwert aus Basis ${base} konvertiert.`);

  const result = await authenticateDnet(ns, host, guess, authAttemptState);
  if (result?.success) {
    logger?.success("🎉 Kandidat erfolgreich authentifiziert.");
    return guess;
  }

  logger?.error("🔴 Berechneter Kandidat wurde abgelehnt.");
  return null;
}