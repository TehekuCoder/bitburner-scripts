import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client";
import { DnetAuthAttemptState } from "/shared/types/network.js";
import { authenticateDnet } from "/infrastructure/runtime/dnet-state.js";

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

export async function solveAnagram(
  ns: NS,
  hostname: string,
  details: any,
  logger?: LoggerClient,
  authAttemptState?: DnetAuthAttemptState,
): Promise<string | null> {
  const rawData = String(details?.data || "").trim();
  if (!rawData) {
    logger?.error("🔴 Fehler: Keine Daten in Serverdetails gefunden.");
    return null;
  }

  if (rawData.length > 8) {
    logger?.warn(`⚠️ Wort ist zu lang (${rawData.length} Zeichen). Abbruch.`);
    return null;
  }

  logger?.info(`🔤 Teste Kombinationen aus ${rawData.length} Zeichen.`);

  let count = 0;
  for (const guess of permute(rawData)) {
    count++;

    if (count % 100 === 0) {
      await ns.asleep(1);
    }

    const result = await authenticateDnet(
      ns,
      hostname,
      guess,
      authAttemptState,
    );
    if (result?.success) {
      logger?.success(`🎉 Authentifizierung nach ${count} Versuchen erfolgreich.`);
      return guess;
    }
  }

  logger?.error(`🔴 Fehlgeschlagen. Kein Anagramm war korrekt.`);
  return null;
}