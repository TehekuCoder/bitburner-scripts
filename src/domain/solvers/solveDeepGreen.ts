import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";

export async function solveDeepGreen(
  ns: NS,
  hostname: string,
  details: any,
  logger?: LoggerClient
): Promise<string | null> {
  const len = details?.passwordLength || 3;
  const currentGuess = new Array(len).fill("0");

  logger?.info(`🧩 Starte Kaskaden-Suche (Länge: ${len})...`);

  for (let pos = len - 1; pos >= 0; pos--) {
    const targetCorrectCount = len - pos;
    let posSolved = false;

    for (let digit = 0; digit <= 9; digit++) {
      currentGuess[pos] = String(digit);
      const guess = currentGuess.join("");

      const result = (await ns.dnet.authenticate(hostname, guess)) as any;
      if (result?.success) {
        logger?.success(`🎉 Direkt-Erfolg: ${guess}`);
        return guess;
      }

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
        await ns.sleep(10);
      }

      if (!logObj || !logObj.data) {
        continue;
      }

      const matches = String(logObj.data).match(/\d+/g);
      if (!matches) continue;

      if (parseInt(matches[0], 10) === targetCorrectCount) {
        posSolved = true;
        logger?.debug(`Position ${pos} gelöst mit Ziffer '${digit}'`);
        break;
      }
    }

    if (!posSolved) {
      logger?.warn(`⚠️ Kaskade an Position ${pos} fehlgeschlagen.`);
    }
  }

  const finalGuess = currentGuess.join("");
  const finalResult = (await ns.dnet.authenticate(hostname, finalGuess)) as any;
  
  if (finalResult?.success) {
    logger?.success(`🎉 Erfolg! Passwort: ${finalGuess}`);
    return finalGuess;
  }

  logger?.error(`🔴 Lösung konnte nicht validiert werden.`);
  return null;
}