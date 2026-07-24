import { NS } from "@ns";
import { drawProgress } from "/utils/progress";

export async function solveDeepGreen(
  ns: NS,
  hostname: string,
  details: any,
): Promise<string | null> {
  const len = details?.passwordLength || 3;
  const currentGuess = new Array(len).fill("0");

  for (let pos = len - 1; pos >= 0; pos--) {
    drawProgress(ns, hostname, len - 1 - pos, len, "DeepGreen");
    const targetCorrectCount = len - pos;

    let posSolved = false;

    for (let digit = 0; digit <= 9; digit++) {
      currentGuess[pos] = String(digit);
      const guess = currentGuess.join("");

      const result = (await ns.dnet.authenticate(hostname, guess)) as any;
      if (result?.success) {
        ns.print(`🎉 [DeepGreen] Volltreffer bei Zwischenprüfung: ${guess}`);
        return guess;
      }

      await ns.sleep(50);

      // Heartbleed-Logs mit Retry-Limit abfragen
      let logObj: any = null;
      for (let retry = 0; retry < 5; retry++) {
        const bleed = (await ns.dnet.heartbleed(hostname)) as any;
        const logs: string[] = bleed?.logs || [];

        for (let i = logs.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(logs[i]);
            if (parsed && String(parsed.passwordAttempted) === guess) {
              logObj = parsed;
              break;
            }
          } catch {
            /* Ignoriere unvollständige JSONs */
          }
        }

        if (logObj) break;
        await ns.sleep(30);
      }

      if (!logObj || !logObj.data) {
        ns.print(`⚠️ [DeepGreen] Kein passender Log für Versuch '${guess}' gefunden.`);
        continue;
      }

      const matches = String(logObj.data).match(/\d+/g);
      if (!matches) continue;

      // Wenn die Anzahl korrekter Stellen mit unserer Zielanzahl übereinstimmt:
      if (parseInt(matches[0], 10) === targetCorrectCount) {
        posSolved = true;
        break; // Ziffer für diese Position steht fest!
      }
    }

    if (!posSolved) {
      ns.print(`🔴 [DeepGreen] Kaskade fehlgeschlagen an Position ${pos}.`);
    }
  }

  // Finaler Check
  const finalGuess = currentGuess.join("");
  const finalResult = (await ns.dnet.authenticate(hostname, finalGuess)) as any;
  if (finalResult?.success) {
    ns.print(`🎉 [DeepGreen] Erfolgreich geknackt: ${finalGuess}`);
    return finalGuess;
  }

  ns.print(`🔴 [DeepGreen] Rekonstruiertes Passwort '${finalGuess}' wurde abgelehnt.`);
  return null;
}