import { NS } from "@ns";
import { drawProgress } from "/utils/progress";

/**
 * Interner Brute-Force-Fallback, falls der Server keine "Higher/Lower"-Hinweise herausrückt.
 */
async function runBruteForceFallback(ns: NS, hostname: string, len: number): Promise<string | null> {
  const maxVal = Math.pow(10, len) - 1;
  ns.tprint(`⚠️ [AccountsManager] Keine Hinweise erhalten. Starte automatischen Brute-Force Fallback...`);

  for (let i = 0; i <= maxVal; i++) {
    const guessStr = i.toString().padStart(len, "0");
    const result = await ns.dnet.authenticate(hostname, guessStr);
    
    if (result.success) {
      return guessStr;
    }
    await ns.sleep(1);
  }
  return null;
}

/**
 * Solver für AccountsManager_4.2 - Löst das Zahlenraten blitzschnell per Binärer Suche.
 */
export async function solveAccountsManager(ns: NS, hostname: string, details: any): Promise<string | null> {
  const len = details.passwordLength;
  if (!len || len <= 0) {
    ns.tprint("🔴 [AccountsManager] Fehler: Ungültige Passwortlänge in den Serverdetails.");
    return null;
  }

  let min = 0;
  let max = Math.pow(10, len) - 1;
  const totalRange = max;

  while (min <= max) {
    // Wir raten immer genau die Mitte des verbleibenden Zahlenraums
    const guess = Math.floor((min + max) / 2);
    const guessStr = guess.toString().padStart(len, "0");

    // Fortschritt anzeigen (wie weit sich der Suchraum verkleinert hat)
    drawProgress(ns, hostname, min, totalRange, "Accounts-Binary");

    const result = await ns.dnet.authenticate(hostname, guessStr);
    if (result.success) {
      ns.tprint(`[AccountsManager] Erfolgreich authentifiziert! Passwort ist: ${guessStr}`);
      return guessStr;
    }

    // Hinweis auswerten (Entweder direkt aus der Antwort oder via Heartbleed-Logs)
    let hint = result.data || "";
    if (!hint) {
      const bleed = await ns.dnet.heartbleed(hostname);
      const logs = typeof bleed === "string" ? bleed : JSON.stringify(bleed.logs || bleed);
      
      if (logs.includes("Higher")) hint = "Higher";
      else if (logs.includes("Lower")) hint = "Lower";
    }

    // Suchraum basierend auf dem Hinweis halbieren
    if (hint === "Higher") {
      min = guess + 1;
    } else if (hint === "Lower") {
      max = guess - 1;
    } else {
      // Wenn absolut kein Hinweis ermittelt werden konnte, springen wir in den Fallback
      return await runBruteForceFallback(ns, hostname, len);
    }

    await ns.sleep(1);
  }

  return null;
}