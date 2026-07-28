import { NS } from "@ns";
import { tryAuth } from "/lib/dnet-utils"; // Pfad ggf. anpassen

export async function solveDeskMemo(
  ns: NS,
  host: string,
  details: any
): Promise<string | null> {
  const hint = String(details?.passwordHint || details?.data || "").trim();
  const targetLen = details?.passwordLength;

  if (!hint) {
    ns.print("🔴 [DeskMemo] Fehler: Kein passwordHint oder data vorhanden.");
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

  ns.print(`📝 [DeskMemo] Teste ${uniqueCandidates.length} Kandidaten aus Hint: "${hint}"`);

  for (const guess of uniqueCandidates) {
    // Hier die neue tryAuth-Funktion nutzen:
    if (await tryAuth(ns, host, guess)) {
      ns.print(`🎉 [DeskMemo] Erfolgreich authentifiziert mit: "${guess}"`);
      return guess;
    }
  }

  ns.print("🔴 [DeskMemo] Fehlgeschlagen. Kein Kandidat war korrekt.");
  return null;
}