import { NS } from "@ns";
import { LoggerClient } from "/lib/logger-client.js";

export async function solveFreshInstall(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient,
): Promise<string | null> {
  const candidates = ["password", "admin", "123456", "root", "guest"];

  logger?.info(`Starte Prüfung gängiger Passwörter für ${host}...`);

  for (const guess of candidates) {
    const res = (await ns.dnet.authenticate(host, guess)) as any;
    if (res === true || res?.success) {
      logger?.success(
        `🎉 Erfolgreich authentifiziert auf ${host} mit: "${guess}"`,
      );
      return guess;
    }
  }

  logger?.error(`🔴 Alle Standard-Passwörter auf ${host} fehlgeschlagen.`);
  return null;
}
