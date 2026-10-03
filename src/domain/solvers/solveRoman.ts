import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { DnetAuthAttemptState } from "/shared/types/network.js";
import { authenticateDnet } from "/infrastructure/runtime/dnet-state.js";

function romanToArabic(roman: string): number {
  const vals: Record<string, number> = {
    I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
  };
  let total = 0;
  const str = roman.toUpperCase();

  for (let i = 0; i < str.length; i++) {
    const cur = vals[str[i]] || 0;
    const next = vals[str[i + 1]] || 0;

    if (next > cur) {
      total += next - cur;
      i++;
    } else {
      total += cur;
    }
  }

  return total;
}

export async function solveRoman(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient,
  authAttemptState?: DnetAuthAttemptState,
): Promise<string | null> {
  const rawText = String(details?.data || details?.passwordHint || "").trim();

  if (!rawText) {
    logger?.error(`🔴 Kein Text/Hint auf ${host} übergeben.`);
    return null;
  }

  const matches = rawText.match(/[IVXLCDM]+/gi) || [];

  for (const romanSeq of matches) {
    const arabicValue = romanToArabic(romanSeq);
    if (arabicValue <= 0) continue;

    const guess = arabicValue.toString();

    const res = await authenticateDnet(ns, host, guess, authAttemptState);
    if (res.success) {
      logger?.success("🎉 Römische Zahl erfolgreich authentifiziert.");
      return guess;
    }
  }

  logger?.error("🔴 Keine passende römische Zahl gefunden.");
  return null;
}