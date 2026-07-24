import { NS } from "@ns";

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

  // Kandidaten sammeln
  const candidates: string[] = [];

  // 1. Alle Ziffern am Stück
  const allDigits = hint.replace(/\D/g, "");
  if (allDigits) candidates.push(allDigits);

  // 2. Einzelne Zahlenblöcke
  const sequences = hint.match(/\d+/g) || [];
  candidates.push(...sequences);

  // 3. Fallback: Wörter aus dem Hinweis (falls das Passwort Text ist)
  const words = hint.match(/\b\w+\b/g) || [];
  candidates.push(...words);

  // Nach Dubletten filtern
  const uniqueCandidates = [...new Set(candidates)];

  // Falls targetLen bekannt ist, nach passender Länge sortieren
  if (targetLen) {
    uniqueCandidates.sort((a, b) => {
      const aMatch = a.length === targetLen ? -1 : 1;
      const bMatch = b.length === targetLen ? -1 : 1;
      return aMatch - bMatch;
    });
  }

  ns.print(`📝 [DeskMemo] Teste ${uniqueCandidates.length} Kandidaten aus Hint: "${hint}"`);

  for (const guess of uniqueCandidates) {
    const res = (await ns.dnet.authenticate(host, guess)) as any;
    if (res?.success) {
      ns.print(`🎉 [DeskMemo] Erfolgreich authentifiziert mit: "${guess}"`);
      return guess;
    }
  }

  ns.print("🔴 [DeskMemo] Fehlgeschlagen. Kein Kandidat war korrekt.");
  return null;
}