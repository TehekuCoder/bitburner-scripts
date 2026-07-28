import { NS } from "@ns";

export async function solveLaika4(ns: NS, host: string, details: any): Promise<string | null> {
  const len = details?.passwordLength;

  // Erweitertes Wörterbuch nach Hundenamen / Raumfahrt-Hunden
  const dict: Record<number, string[]> = {
    3: ["max", "dog", "sam"],
    4: ["fido", "spot", "bark", "milo", "duke"],
    5: ["rover", "laika", "belka", "strel", "chayk"],
    6: ["sputnik", "apollo", "shadow"],
  };

  const candidates = (len && dict[len]) ? dict[len] : [
    "rover", "laika", "fido", "spot", "max", "belka", "strelka", "apollo", "sputnik"
  ];

  for (const guess of candidates) {
    const result = (await ns.dnet.authenticate(host, guess)) as any;
    if (result?.success) {
      return guess;
    }
  }

  ns.print(`[Laika4] ❌ Keiner der ${candidates.length} Kandidaten hat für ${host} funktioniert.`);
  return null;
}