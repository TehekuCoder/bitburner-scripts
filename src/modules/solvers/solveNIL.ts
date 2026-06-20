import { NS } from "@ns";
// WICHTIG: Passe diesen Pfad an, je nachdem wo deine drawProgress-Funktion liegt
import { drawProgress } from "/utils/progress"; 

/**
 * Solver für NIL - Rekonstruiert das Passwort schrittweise über Log-Analyse via Heartbleed.
 */
export async function solveNIL(ns: NS, hostname: string, details: any): Promise<string | null> {
  const len = details.passwordLength || 5;
  const digits = new Array(len).fill(0);
  const locked = new Array(len).fill(false);

  while (locked.includes(false)) {
    const guess = digits.join("");

    // Fortschritt in deiner Progress Bar anzeigen
    const currentLocked = locked.filter((v) => v).length;
    drawProgress(ns, hostname, currentLocked, len, "NIL-Locking");

    const result = await ns.dnet.authenticate(hostname, guess);
    if (result.success) {
      ns.print(`[NIL] Erfolgreich authentifiziert mit Passwort: ${guess}`);
      return guess; // Passwort direkt für das Hauptskript/Loot zurückgeben
    }

    let logObj = null;

    // TIMING-FIX: Erhöht auf 15 Versuche mit 20ms Sleep (max 300ms),
    // um Verzögerungen durch die vorherige Dictionary-Attacke abzufangen.
    for (let check = 0; check < 15; check++) {
      const bleed = (await ns.dnet.heartbleed(hostname)) as any;
      if (bleed && bleed.logs && bleed.logs.length > 0) {
        // Wir suchen von hinten (neueste Logs zuerst)
        for (let i = bleed.logs.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(bleed.logs[i]);
            if (parsed && String(parsed.passwordAttempted) === guess) {
              logObj = parsed;
              break;
            }
          } catch (e) {}
        }
      }
      if (logObj) break;
      await ns.sleep(20);
    }

    // Wenn kein Log gefunden wurde, kurz warten und den Versuch wiederholen
    if (!logObj || !logObj.data) {
      await ns.sleep(50);
      continue;
    }

    // --- FORMATIERUNGS-FIX (IMMUN GEGEN LEERZEICHEN & ARRAYS) ---
    // Konvertiert das Feedback sauber in Kleinbuchstaben und entfernt alle Whitespaces.
    const feedback: string[] =
      typeof logObj.data === "string"
        ? logObj.data.split(",").map((v: string) => v.trim().toLowerCase())
        : Array.isArray(logObj.data)
          ? logObj.data.map((v: unknown) => String(v).trim().toLowerCase())
          : [];

    // Ziffern auswerten
    for (let i = 0; i < len; i++) {
      const val = feedback[i];
      // Akzeptiert "yes", "true" oder "1"
      if (val === "yes" || val === "true" || val === "1") {
        locked[i] = true;
      } else if (!locked[i]) {
        // Nur erhöhen, wenn diese Stelle noch nicht als korrekt eingeloggt gilt
        digits[i] = (digits[i] + 1) % 10;
      }
    }
    await ns.sleep(10);
  }

  // Finaler Login-Versuch mit dem komplett rekonstruierten Passwort
  const finalGuess = digits.join("");
  const finalResult = await ns.dnet.authenticate(hostname, finalGuess);
  if (finalResult.success) {
    ns.print(`[NIL] Erfolgreich authentifiziert mit finalem Passwort: ${finalGuess}`);
    return finalGuess;
  }

  ns.print(`🔴 [NIL] Fehler: Rekonstruiertes Passwort '${finalGuess}' wurde vom Server abgelehnt.`);
  return null;
}