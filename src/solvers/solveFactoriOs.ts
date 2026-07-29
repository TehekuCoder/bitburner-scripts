import { NS } from "@ns";
import { LoggerClient } from "/lib/logger-client.js";

export async function solveFactoriOs(
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient
): Promise<string | null> {
  logger?.info(`⚙️ Starte Krypto-Sieb für Factori-Os auf ${host}...`);

  const len = details?.passwordLength || 3;

  if (len === 1) {
    for (let num = 0; num <= 9; num++) {
      const res = (await ns.dnet.authenticate(host, num.toString())) as any;
      if (res?.success) {
        logger?.success(`🎉 Blitz-Erfolg: ${num}`);
        return num.toString();
      }
    }
    return null;
  }

  const min = Math.pow(10, len - 1);
  const max = Math.pow(10, len) - 1;
  let candidates = Array.from({ length: max - min + 1 }, (_, i) => i + min);

  while (candidates.length > 0) {
    const nextAttempt = candidates[0];

    logger?.debug(`Teste: ${nextAttempt} (Kandidaten verbleibend: ${candidates.length})`);
    const result = (await ns.dnet.authenticate(host, nextAttempt.toString())) as any;

    if (result?.success) {
      logger?.success(`🎉 Erfolg! Passwort: ${nextAttempt}`);
      return nextAttempt.toString();
    }

    candidates = candidates.filter((num) => num !== nextAttempt);

    const bleedData = (await ns.dnet.heartbleed(host)) as any;
    const logs: string[] = bleedData?.logs || [];

    for (const logLine of logs) {
      const regex = /Password is (not )?divisible by '(\d+)'/;
      const match = logLine.match(regex);

      if (match) {
        const isNotDivisible = match[1] === "not ";
        const divisor = parseInt(match[2], 10);

        if (!isNaN(divisor) && divisor !== 0) {
          candidates = candidates.filter((num) => {
            const isDivisible = num % divisor === 0;
            return isNotDivisible ? !isDivisible : isDivisible;
          });
        }
      }
    }

    await ns.asleep(10);
  }

  logger?.error(`🔴 Keine passende Zahl im Bereich für ${host} gefunden.`);
  return null;
}