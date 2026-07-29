import { NS } from "@ns";
import { LoggerClient } from "/lib/logger-client.js";

export async function solveLaika4(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient
): Promise<string | null> {
  const len = details?.passwordLength;

  const dict: Record<number, string[]> = {
    3: ["max", "dog", "sam"],
    4: ["fido", "spot", "bark", "milo", "duke"],
    5: ["rover", "laika", "belka", "strel", "chayk"],
    6: ["sputnik", "apollo", "shadow"],
  };

  const candidates = (len && dict[len]) ? dict[len] : [
    "rover", "laika", "fido", "spot", "max", "belka", "strelka", "apollo", "sputnik"
  ];

  logger?.info(`🐕 Teste ${candidates.length} Wörterbuch-Einträge...`);

  for (const guess of candidates) {
    const result = (await ns.dnet.authenticate(host, guess)) as any;
    if (result?.success) {
      logger?.success(`🎉 Treffer: "${guess}"`);
      return guess;
    }
  }

  logger?.error(`❌ Keiner der ${candidates.length} Kandidaten hat funktioniert.`);
  return null;
}