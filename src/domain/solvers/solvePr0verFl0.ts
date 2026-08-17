import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";

export async function solvePr0verFl0(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient
): Promise<string | null> {
  const len = details?.passwordLength || 8;

  // Typische Buffer-Overflow Testmuster
  const payloads = [
    "A".repeat(len * 2),
    "A".repeat(len + 1),
    "A".repeat(len),
    "0".repeat(len * 2),
  ];

  logger?.info(`🌊 Sende Buffer-Overflow Payloads an ${host}...`);

  for (const payload of payloads) {
    const result = (await ns.dnet.authenticate(host, payload)) as any;
    if (result?.success) {
      logger?.success(`🎉 Overflow erfolgreich mit Payload-Länge ${payload.length}!`);
      return payload;
    }
  }

  logger?.error(`🔴 Overflow-Versuche auf ${host} fehlgeschlagen.`);
  return null;
}