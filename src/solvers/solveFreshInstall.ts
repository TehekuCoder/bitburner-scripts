// solveFreshInstall.ts
import { NS } from "@ns";

export async function solveFreshInstall(ns: NS, host: string, details: any): Promise<string | null> {
  const len = details?.passwordLength;
  // Typische Standard-Passwörter
  const candidates = ["0000", "12345", "admin", "password", "guest", "root", "1234"];

  for (const guess of candidates) {
    // Falls Länge bekannt ist, nur passende Längen testen
    if (len && guess.length !== len) continue;

    const result = (await ns.dnet.authenticate(host, guess)) as any;
    if (result?.success) {
      ns.print(`[FreshInstall] Erfolg mit: ${guess}`);
      return guess;
    }
  }

  return null;
}