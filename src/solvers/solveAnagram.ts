import { NS } from "@ns";

/**
 * Generator für eindeutige Permutationen (spart Speicher & vermeidet Duplikate)
 */
function* permute(str: string): Generator<string> {
  if (str.length <= 1) {
    yield str;
    return;
  }
  const used = new Set<string>();
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (used.has(char)) continue; // Duplikate überspringen
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
  details: any
): Promise<string | null> {
  const rawData = String(details?.data || "").trim();
  if (!rawData) {
    ns.print("🔴 [Anagram] Fehler: Keine Daten in Serverdetails gefunden.");
    return null;
  }

  // Schutz vor extrem langen Worten (9! = 362.880 -> würde zu lange dauern)
  if (rawData.length > 8) {
    ns.print(`⚠️ [Anagram] Wort '${rawData}' ist zu lang (${rawData.length} Zeichen). Abbruch.`);
    return null;
  }

  ns.print(`🔤 [Anagram] Teste Kombinationen für: "${rawData}"`);

  let count = 0;
  for (const guess of permute(rawData)) {
    count++;

    // Alle 100 Versuche kurz die UI/Event-Loop entlasten
    if (count % 100 === 0) {
      await ns.asleep(1);
    }

    const result = (await ns.dnet.authenticate(hostname, guess)) as any;
    if (result?.success) {
      ns.print(`🎉 [Anagram] Erfolg nach ${count} Versuchen! Passwort: ${guess}`);
      return guess;
    }
  }

  ns.print(`🔴 [Anagram] Fehlgeschlagen. Kein Anagramm war korrekt.`);
  return null;
}