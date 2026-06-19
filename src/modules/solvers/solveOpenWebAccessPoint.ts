import { NS } from "@ns";

/**
 * Dynamischer Solver für OpenWebAccessPoint.
 * Nutzt die server-spezifische Datenlecksicherheitslücke [hostname]:[password].
 */
export async function solveOpenWebAccessPoint(ns: NS, hostname: string, details: any): Promise<string | null> {
  
  // Da Hostnames Sonderzeichen wie % oder @ enthalten können (siehe dark%matrix),
  // müssen wir sie für die RegEx-Engine sicherheitshalber eskapieren.
  const escapedHost = hostname.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  
  // 🔥 STRATEGIE 0: Der dynamische Detektor
  // Erstellt live eine Suchmaske für "hostname:PASSWORT"
  const leakRegex = new RegExp(`${escapedHost}:(\\w+)`);

  for (let i = 0; i < 5; i++) {
    const bleed = await ns.dnet.heartbleed(hostname);
    const bleedStr = typeof bleed === "string" ? bleed : JSON.stringify(bleed);

    // Versuche das dynamische Passwort-Muster aus dem Speicher-Dump zu fischen
    const leakMatch = bleedStr.match(leakRegex);
    
    if (leakMatch && leakMatch[1]) {
      const candidate = leakMatch[1];
      ns.print(`[OpenWebAccessPoint] Leak erkannt! Gefundener Key: ${candidate}`);
      
      const resLeak = await ns.dnet.authenticate(hostname, candidate);
      if (resLeak.success) {
        ns.tprint(`🎯 [OpenWebAccessPoint] OWAP-Exploit erfolgreich bei ${hostname} (Versuch ${i + 1})! Passwort: ${candidate}`);
        return candidate; 
      }
    }

    // ======================================================================
    // 🛡️ FALLBACK-ZONE: Falls das spezifische Muster im Dump mal verschoben ist
    // ======================================================================
    
    // 1. Alternativ-Muster: Explizite Zuweisungen (z.B. password is: XYZ)
    const exactMatch = bleedStr.match(/password\s*is\s*[:=]\s*(\w+)/i);
    if (exactMatch) {
      const candidate = exactMatch[1];
      const resExact = await ns.dnet.authenticate(hostname, candidate);
      if (resExact.success) {
        ns.tprint(`[OpenWebAccessPoint] Volltreffer via Freitext-Analyse bei Versuch ${i + 1}: ${candidate}`);
        return candidate;
      }
    }

    // 2. Letzter Ausweg: Kompletter Speicher-Crawl
    const allCandidates = bleedStr.match(/\b\w+\b/g) || [];
    const uniqueCandidates = [...new Set(allCandidates)];

    for (const candidate of uniqueCandidates) {
      if (details.passwordLength && candidate.length !== details.passwordLength) {
        continue;
      }
      if (leakMatch && candidate === leakMatch[1]) {
        continue;
      }

      const resCand = await ns.dnet.authenticate(hostname, candidate);
      if (resCand.success) {
        ns.tprint(`[OpenWebAccessPoint] Failsafe-Erfolg via Speicher-Crawl bei Versuch ${i + 1}: ${candidate}`);
        return candidate;
      }
    }

    await ns.sleep(200);
  }

  ns.tprint(`🔴 [OpenWebAccessPoint] Fehlgeschlagen. Kein Passwort auf ${hostname} isoliert.`);
  return null;
}