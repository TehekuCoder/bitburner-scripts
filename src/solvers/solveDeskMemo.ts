import { NS } from "@ns";
import { LoggerClient } from "/lib/logger-client.js";

export async function solveDeskMemo(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient
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

  logger?.info(`📝 Teste ${uniqueCandidates.length} Kandidaten aus Hint: "${hint}"`);

  for (const guess of uniqueCandidates) {
    // ⚡ Direktes Authentifizieren ohne Wrapper
    const res = (await ns.dnet.authenticate(host, guess)) as any;
    const success = typeof res === "boolean" ? res : Boolean(res?.success);

    if (success) {
      logger?.success(`🎉 Erfolgreich authentifiziert mit: "${guess}"`);
      return guess;
    }
  }

  logger?.error("🔴 Fehlgeschlagen. Kein Kandidat war korrekt.");
  return null;
}