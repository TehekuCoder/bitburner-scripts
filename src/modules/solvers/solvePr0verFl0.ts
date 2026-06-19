import { NS } from "@ns";

export async function solvePr0verFl0(ns: NS, host: string, details: any): Promise<string | null> {
  const len = details.passwordLength;

  if (!len) {
    ns.tprint(`🔴 [Pr0verFl0] Fehler: Ungültige oder fehlende Passwortlänge auf ${host}.`);
    return null;
  }

  return "A".repeat(len * 2);
}