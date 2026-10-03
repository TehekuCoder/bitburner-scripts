import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { DnetAuthAttemptState } from "/shared/types/network.js";
import { authenticateDnet } from "/infrastructure/runtime/dnet-state.js";

export async function solveZeroLogon(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient,
  authAttemptState?: DnetAuthAttemptState,
): Promise<string | null> {
  const len = details?.passwordLength;

  const candidates = [
    "",
    "0",
    "00000000",
    len ? "0".repeat(len) : "",
  ];

  const uniqueCandidates = [...new Set(candidates)];
  logger?.info(`Starte ZeroLogon-Bypass Prüfungen...`);

  for (const guess of uniqueCandidates) {
    const result = await authenticateDnet(ns, host, guess, authAttemptState);
    if (result?.success) {
      logger?.success("🎉 Bypass erfolgreich.");
      return guess;
    }
  }

  logger?.error(`🔴 Bypass auf ${host} fehlgeschlagen.`);
  return null;
}