import { NS } from "@ns";

/**
 * Interne Hilfsfunktion: Generiert alle eindeutigen Permutationen (Anagramme) eines Strings.
 */
function getPermutations(str: string): string[] {
  if (str.length <= 1) return [str];
  const perms = new Set<string>();
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const remaining = str.slice(0, i) + str.slice(i + 1);
    
    for (const p of getPermutations(remaining)) {
      perms.add(char + p);
    }
  }
  return Array.from(perms);
}

/**
 * Solver für Anagramme (solvePHP) - Testet alle Permutationen des übergebenen Strings.
 */
export async function solveAnagram(ns: NS, hostname: string, details: any): Promise<string | null> {
  if (!details.data) {
    ns.print("🔴 [Anagram] Fehler: Keine Daten (Buchstabensalat) in den Serverdetails gefunden.");
    return null;
  }

  // Alle möglichen Kombinationen berechnen
  const candidates = getPermutations(details.data);

  // Alle Kombinationen nacheinander durchtesten
  for (const guess of candidates) {
    const result = await ns.dnet.authenticate(hostname, guess);
    
    if (result.success) {
      ns.print(`[Anagram] Erfolgreich authentifiziert mit Passwort: ${guess}`);
      return guess; // Gefundenes Passwort für das Hauptskript/Loot zurückgeben
    }
  }

  ns.print(`🔴 [Anagram] Fehlgeschlagen. Kein Anagramm von '${details.data}' war korrekt.`);
  return null;
}