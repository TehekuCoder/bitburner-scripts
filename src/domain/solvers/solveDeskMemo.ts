import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { DnetAuthAttemptState } from "/shared/types/network.js";
import { authenticateDnet } from "/infrastructure/runtime/dnet-state.js";

export async function solveDeskMemo(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient,
  authAttemptState?: DnetAuthAttemptState,
): Promise<string | null> {
  const hint = String(details?.passwordHint || details?.data || "").trim();
  const targetLen = details?.passwordLength;

  if (!hint) {
    logger?.error("🔴 Fehler: Kein passwordHint oder data vorhanden.");
    return null;
  }

  const candidates: string[] = [];

  const allDigits = hint.replace(/\D/g, "");
  if (allDigits) candidates.push(allDigits);

  const sequences = hint.match(/\d+/g) || [];
  candidates.push(...sequences);

  const words = hint.match(/\b\w+\b/g) || [];
  candidates.push(...words);

  const uniqueCandidates = [...new Set(candidates)];

  if (targetLen) {
    uniqueCandidates.sort((a, b) => {
      const aMatch = a.length === targetLen ? -1 : 1;
      const bMatch = b.length === targetLen ? -1 : 1;
      return aMatch - bMatch;
    });
  }

  logger?.info(`📝 Teste ${uniqueCandidates.length} Kandidaten aus dem Hint.`);

  for (const guess of uniqueCandidates) {
    // ⚡ Direktes Authentifizieren ohne Wrapper
    const res = await authenticateDnet(ns, host, guess, authAttemptState);

    if (res.success) {
      logger?.success("🎉 Erfolgreich authentifiziert.");
      return guess;
    }
  }

  logger?.error("🔴 Fehlgeschlagen. Kein Kandidat war korrekt.");
  return null;
}