import { NS } from "@ns";
import { tryAuth } from "/lib/dnet-utils"; // Pfad zu deiner tryAuth-Funktion

export async function solveFreshInstall(
  ns: NS,
  host: string,
  details: any
): Promise<string | null> {
  // Liste gängiger Standard-Passwörter für FreshInstall
  const candidates = ["password", "admin", "123456", "root", "guest"];

  ns.print(`[FreshInstall] Starte Prüfung für ${host}...`);

  for (const guess of candidates) {
    // tryAuth stellt die Verbindung her, falls isConnectedToCurrentServer === false
    if (await tryAuth(ns, host, guess)) {
      ns.print(`🎉 [FreshInstall] Erfolgreich authentifiziert auf ${host} mit: "${guess}"`);
      return guess;
    }
  }

  ns.print(`🔴 [FreshInstall] Alle Standard-Passwörter auf ${host} fehlgeschlagen.`);
  return null;
}