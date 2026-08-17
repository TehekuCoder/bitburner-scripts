import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client";

export function solveCloudBlare(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient
): string | null {
  const data = details?.data || "";
  logger?.debug(`Verarbeite Data-String: "${data}"`);

  // Extrahiere nur Ziffern
  const cleaned = data.replace(/\D/g, "");

  if (cleaned.length > 0) {
    logger?.success(`Lösung gefunden: ${cleaned}`);
    return cleaned;
  }

  logger?.warn(`Konnte keine Ziffern in "${data}" finden.`);
  return null;
}