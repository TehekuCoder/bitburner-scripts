import { NS } from "@ns";

/**
 * Solver für OpenWebAccessPoint - Liest via Heartbleed den Speicher aus und analysiert ihn.
 */
export async function solveOpenWebAccessPoint(ns: NS, hostname: string, details: any): Promise<string | null> {
  // Das Original versucht es bis zu 5 Mal, da Heartbleed jedes Mal andere Speicherbereiche liefern kann
  for (let i = 0; i < 5; i++) {
    const bleed = await ns.dnet.heartbleed(hostname);
    // Falls dnet.heartbleed ein Objekt statt eines Strings liefert, wandeln wir es in Text um
    const bleedStr = typeof bleed === "string" ? bleed : JSON.stringify(bleed);

    // 1. Strategie: Nach einer expliziten Passwort-Zuweisung suchen (z.B. "password is: abc" oder "password=abc")
    const exactMatch = bleedStr.match(/password\s*is\s*[:=]\s*(\w+)/i);
    if (exactMatch) {
      const candidate = exactMatch[1];
      const resExact = await ns.dnet.authenticate(hostname, candidate);
      if (resExact.success) {
        ns.tprint(`[OpenWebAccessPoint] Volltreffer via Freitext-Analyse bei Versuch ${i + 1}: ${candidate}`);
        return candidate; // Passwort für Hauptskript/Loot zurückgeben
      }
    }

    // 2. Strategie: Alle isolierten Wörter extrahieren und systematisch durchtesten
    const allCandidates = bleedStr.match(/\b\w+\b/g) || [];
    // Duplikate entfernen, um unnötige Netzwerk-Anfragen zu sparen
    const uniqueCandidates = [...new Set(allCandidates)];

    for (const candidate of uniqueCandidates) {
      // Optimierung: Wenn wir die erwartete Länge kennen, überspringen wir falsche Wortlängen
      if (details.passwordLength && candidate.length !== details.passwordLength) {
        continue;
      }

      const resCand = await ns.dnet.authenticate(hostname, candidate);
      if (resCand.success) {
        ns.tprint(`[OpenWebAccessPoint] Erfolg via Speicher-Crawl bei Versuch ${i + 1}: ${candidate}`);
        return candidate;
      }
    }

    // Falls dieser Durchlauf nichts brachte, warten wir 200ms, bevor der nächste Speicherbereich gelesen wird
    await ns.sleep(200);
  }

  ns.tprint(`🔴 [OpenWebAccessPoint] Fehlgeschlagen. Auch nach 5 Heartbleed-Dumps wurde kein Passwort gefunden.`);
  return null;
}