import { NS } from "@ns";
import { LoggerClient } from "/lib/logger-client.js";

export async function solveZeroLogon(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient
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
    const result = (await ns.dnet.authenticate(host, guess)) as any;
    if (result?.success) {
      logger?.success(`🎉 Bypass erfolgreich mit: "${guess}"`);
      return guess;
    }
  }

  logger?.error(`🔴 Bypass auf ${host} fehlgeschlagen.`);
  return null;
}