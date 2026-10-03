import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { DnetAuthAttemptState } from "/shared/types/network.js";
import { authenticateDnet } from "/infrastructure/runtime/dnet-state.js";

export async function solveLaika4(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient,
  authAttemptState?: DnetAuthAttemptState,
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
    const result = await authenticateDnet(ns, host, guess, authAttemptState);
    if (result?.success) {
      logger?.success("🎉 Wörterbuch-Kandidat erfolgreich authentifiziert.");
      return guess;
    }
  }

  logger?.error(`❌ Keiner der ${candidates.length} Kandidaten hat funktioniert.`);
  return null;
}