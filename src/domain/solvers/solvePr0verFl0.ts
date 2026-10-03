import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { DnetAuthAttemptState } from "/shared/types/network.js";
import { authenticateDnet } from "/infrastructure/runtime/dnet-state.js";

export async function solvePr0verFl0(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient,
  authAttemptState?: DnetAuthAttemptState,
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
    const result = await authenticateDnet(
      ns,
      host,
      payload,
      authAttemptState,
    );
    if (result?.success) {
      logger?.success(`🎉 Overflow erfolgreich mit Payload-Länge ${payload.length}!`);
      return payload;
    }
  }

  logger?.error(`🔴 Overflow-Versuche auf ${host} fehlgeschlagen.`);
  return null;
}