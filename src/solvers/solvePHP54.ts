import { NS } from "@ns";
import { LoggerClient } from "/lib/logger-client.js";

function* permute(str: string): Generator<string> {
  if (str.length <= 1) {
    yield str;
    return;
  }
  const used = new Set<string>();
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (used.has(char)) continue;
    used.add(char);

    const remaining = str.slice(0, i) + str.slice(i + 1);
    for (const p of permute(remaining)) {
      yield char + p;
    }
  }
}

export async function solvePHP54(
  ns: NS,
  hostname: string,
  details: any,
  logger?: LoggerClient
): Promise<string | null> {
  const rawData = String(details?.data || "").trim();

  if (!rawData) {
    logger?.error("🔴 Fehler: Keine Daten in Serverdetails gefunden.");
    return null;
  }

  if (rawData.length > 8) {
    logger?.warn(`⚠️ Zahlenfolge '${rawData}' ist zu lang (${rawData.length} Zeichen). Abbruch.`);
    return null;
  }

  logger?.info(`🔢 Teste Permutationen für die sortierte Zahl: "${rawData}"`);

  let count = 0;
  for (const guess of permute(rawData)) {
    count++;

    if (count % 100 === 0) {
      await ns.asleep(1);
    }

    const result = (await ns.dnet.authenticate(hostname, guess)) as any;
    if (result?.success) {
      logger?.success(`🎉 Erfolg nach ${count} Versuchen! Passwort lautet: ${guess}`);
      return guess;
    }
  }

  logger?.error(`🔴 Fehlgeschlagen. Keine der Permutationen war korrekt.`);
  return null;
}