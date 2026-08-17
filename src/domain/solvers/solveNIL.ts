import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";

export async function solveNIL(
  ns: NS,
  hostname: string,
  details: any,
  logger?: LoggerClient
): Promise<string | null> {
  const len = details?.passwordLength || 5;
  const digits = new Array(len).fill(0);
  const locked = new Array(len).fill(false);

  let attempts = 0;
  const maxAttempts = len * 12;

  logger?.info(`Starte iterative Digits-Suche für Länge ${len}...`);

  while (locked.includes(false) && attempts < maxAttempts) {
    attempts++;
    const guess = digits.join("");

    const result = (await ns.dnet.authenticate(hostname, guess)) as any;
    if (result?.success) {
      logger?.success(`🎉 Direkt-Erfolg: ${guess}`);
      return guess;
    }

    let logObj: any = null;
    for (let check = 0; check < 5; check++) {
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
          /* Ignoriere fehlerhafte JSONs */
        }
      }

      if (logObj) break;
      await ns.sleep(10);
    }

    if (!logObj || !logObj.data) {
      continue;
    }

    const feedback: string[] = Array.isArray(logObj.data)
      ? logObj.data.map((v: unknown) => String(v).trim().toLowerCase())
      : typeof logObj.data === "string"
      ? logObj.data.split(",").map((v: string) => v.trim().toLowerCase())
      : [];

    for (let i = 0; i < len; i++) {
      const val = feedback[i];
      if (val === "yes" || val === "true" || val === "1") {
        locked[i] = true;
      } else if (!locked[i]) {
        digits[i] = (digits[i] + 1) % 10;
      }
    }
  }

  const finalGuess = digits.join("");
  const finalResult = (await ns.dnet.authenticate(hostname, finalGuess)) as any;
  
  if (finalResult?.success) {
    logger?.success(`🎉 Erfolg! Passwort: ${finalGuess}`);
    return finalGuess;
  }

  logger?.error(`🔴 Iteration abgebrochen oder Limit überschritten.`);
  return null;
}