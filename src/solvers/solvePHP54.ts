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
    if (used.has(char)) continue; // Duplikate überspringen, falls z. B. "133" übergeben wird
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
  details: any
): Promise<string | null> {
  // Das gegebene Datenfeld (die sortierte Zahl) als String einlesen
  const rawData = String(details?.data || "").trim();
  
  if (!rawData) {
    ns.print("🔴 [PHP 5.4] Fehler: Keine Daten in Serverdetails gefunden.");
    return null;
  }

  // Schutz vor extrem langen Permutationen (wie beim Anagramm)
  // Bei > 8 Zeichen (Fakultät 8! = 40.320) wird es zu rechenintensiv für einen schnellen Solver
  if (rawData.length > 8) {
    ns.print(`⚠️ [PHP 5.4] Zahlenfolge '${rawData}' ist zu lang (${rawData.length} Zeichen). Abbruch.`);
    return null;
  }

  ns.print(`🔢 [PHP 5.4] Teste Permutationen für die sortierte Zahl: "${rawData}"`);

  let count = 0;
  for (const guess of permute(rawData)) {
    count++;

    // Alle 100 Versuche kurz die UI/Event-Loop entlasten
    if (count % 100 === 0) {
      await ns.asleep(1);
    }

    const result = (await ns.dnet.authenticate(hostname, guess)) as any;
    if (result?.success) {
      ns.print(`🎉 [PHP 5.4] Erfolg nach ${count} Versuchen! Passwort lautet: ${guess}`);
      return guess;
    }
  }

  ns.print(`🔴 [PHP 5.4] Fehlgeschlagen. Keine der Permutationen war korrekt.`);
  return null;
}