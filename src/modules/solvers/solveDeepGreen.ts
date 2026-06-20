import { NS } from "@ns";
import { drawProgress } from "/utils/progress";

/**
 * Solver für DeepGreen - Knackt das Passwort rückwärts (von hinten nach vorne) via Heartbleed-Log-Zähler.
 */
export async function solveDeepGreen(ns: NS, hostname: string, details: any): Promise<string | null> {
  const len = details.passwordLength || 3;
  const currentGuess = new Array(len).fill("x");

  for (let pos = len - 1; pos >= 0; pos--) {
    // Fortschritt anzeigen (wieviele Stellen von hinten gelöst wurden)
    drawProgress(ns, hostname, len - 1 - pos, len, "DeepGreen");

    const targetCorrectCount = len - pos;

    for (let digit = 0; digit <= 9; digit++) {
      currentGuess[pos] = String(digit);
      const guess = currentGuess.join("");

      const result = await ns.dnet.authenticate(hostname, guess);
      if (result.success) {
        ns.print(`[DeepGreen] Erfolgreich authentifiziert mit Passwort: ${guess}`);
        return guess; // Direktes Passwort-Looting triggern
      }

      await ns.sleep(100);

      let logObj = null;
      for (let check = 0; check < 10; check++) {
        const bleed = (await ns.dnet.heartbleed(hostname)) as any;
        if (bleed && bleed.logs && bleed.logs.length > 0) {
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
        await ns.sleep(50);
      }

      if (!logObj || !logObj.data) {
        digit--; // Versuch wiederholen, falls Heartbleed leer war
        continue;
      }

      const matches = logObj.data.match(/\d+/g);
      if (!matches) continue;

      // Wenn die Anzahl korrekter Zeichen im Log mit unserem Target übereinstimmt,
      // steht die aktuelle Ziffer fest und wir gehen zur nächsten Position über.
      if (parseInt(matches[0], 10) === targetCorrectCount) {
        break;
      }
    }
  }

  // Finaler Testlauf des komplett rekonstruierten Passworts
  const finalGuess = currentGuess.join("");
  const finalResult = await ns.dnet.authenticate(hostname, finalGuess);
  if (finalResult.success) {
    ns.print(`[DeepGreen] Erfolgreich authentifiziert mit finalem Passwort: ${finalGuess}`);
    return finalGuess;
  }

  ns.print(`🔴 [DeepGreen] Fehler: Das rekonstruierte Passwort '${finalGuess}' wurde abgelehnt.`);
  return null;
}