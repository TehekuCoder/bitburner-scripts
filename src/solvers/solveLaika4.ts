// solveLaika4.ts
import { NS } from "@ns";

export async function solveLaika4(ns: NS, host: string, details: any): Promise<string | null> {
  const len = details?.passwordLength;
  
  const dict: Record<number, string[]> = {
    3: ["max", "dog"],
    4: ["fido", "spot", "bark"],
    5: ["rover", "laika"],
  };

  const candidates = dict[len] || ["rover", "fido", "spot", "max", "laika"];

  for (const guess of candidates) {
    const result = (await ns.dnet.authenticate(host, guess)) as any;
    if (result?.success) {
      ns.print(`[Laika4] Erfolg mit: ${guess}`);
      return guess;
    }
  }

  return null;
}