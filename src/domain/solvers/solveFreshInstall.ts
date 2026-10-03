import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { DnetAuthAttemptState } from "/shared/types/network.js";
import { authenticateDnet } from "/infrastructure/runtime/dnet-state.js";

export async function solveFreshInstall(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient,
  authAttemptState?: DnetAuthAttemptState,
): Promise<string | null> {
  const candidates = ["password", "admin", "12345", "root","0000"];

  logger?.info(`Starte Prüfung gängiger Passwörter für ${host}...`);

  for (const guess of candidates) {
    const res = await authenticateDnet(ns, host, guess, authAttemptState);
    if (res.success) {
      logger?.success(
        `🎉 Erfolgreich authentifiziert auf ${host}.`,
      );
      return guess;
    }
  }

  logger?.error(`🔴 Alle Standard-Passwörter auf ${host} fehlgeschlagen.`);
  return null;
}
