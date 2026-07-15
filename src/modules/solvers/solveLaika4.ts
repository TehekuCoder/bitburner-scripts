import { NS } from "@ns";

export async function solveLaika4(ns: NS, host: string, details: any): Promise<string | null> {
  const len = details.passwordLength;
  let candidates: string[] = [];

  if (len === 3) candidates = ["max"];
  else if (len === 5) candidates = ["rover"];
  else if (len === 4) candidates = ["fido", "spot"];

  // Teste die Kandidaten direkt selbst durch
  for (const guess of candidates) {
    const result = await ns.dnet.authenticate(host, guess);
    if (result && result.success) {
      ns.print(`[Laika4] Erfolg mit Passwort: ${guess}`);
      return guess;
    }
  }

  return null;
}