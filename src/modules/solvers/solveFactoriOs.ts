import { NS } from "@ns";

/**
 * Brute-force für Factori-Os (Gibt das Passwort bei Erfolg zurück).
 */
export async function solveFactoriOs(ns: NS, hostname: string): Promise<string | null> {
  for (let guess = 2; guess < 100; guess += 2) {
    // Antwort-Objekt auffangen
    const result = await ns.dnet.authenticate(hostname, guess.toString());
    
    // Explizit auf die success-Eigenschaft des Objekts prüfen
    if (result.success) {
      ns.tprint(`[Factori-Os] Erfolgreich authentifiziert mit Zahl: ${guess}`);
      return guess.toString(); // Passwort als String zurückgeben
    }
  }
  
  ns.tprint(`🔴 [Factori-Os] Fehlgeschlagen. Keine gerade Zahl zwischen 2 und 98 war korrekt.`);
  return null;
}