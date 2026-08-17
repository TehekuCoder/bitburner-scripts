import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";

export async function solveOpenWebAccessPoint(
  ns: NS,
  hostname: string,
  details: any,
  logger?: LoggerClient
): Promise<string | null> {
  const escapedHost = hostname.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  const leakRegex = new RegExp(`${escapedHost}:(\\w+)`, "i");

  const testedCandidates = new Set<string>();

  for (let i = 0; i < 5; i++) {
    const bleed = (await ns.dnet.heartbleed(hostname)) as any;
    const bleedStr = typeof bleed === "string" ? bleed : JSON.stringify(bleed);

    // 1. Direktes Leak-Muster
    const leakMatch = bleedStr.match(leakRegex);
    if (leakMatch && leakMatch[1]) {
      const candidate = leakMatch[1];
      if (!testedCandidates.has(candidate)) {
        testedCandidates.add(candidate);
        logger?.info(`Leak erkannt: ${candidate}`);

        const res = (await ns.dnet.authenticate(hostname, candidate)) as any;
        if (res?.success) {
          logger?.success(`🎉 Leak erfolgreich: ${candidate}`);
          return candidate;
        }
      }
    }

    // 2. Freitext-Muster
    const exactMatch = bleedStr.match(/password\s*is\s*[:=]\s*(\w+)/i);
    if (exactMatch && exactMatch[1]) {
      const candidate = exactMatch[1];
      if (!testedCandidates.has(candidate)) {
        testedCandidates.add(candidate);

        const res = (await ns.dnet.authenticate(hostname, candidate)) as any;
        if (res?.success) {
          logger?.success(`🎉 Freitext-Match erfolgreich: ${candidate}`);
          return candidate;
        }
      }
    }

    // 3. Fallback: Speicher-Crawl
    const allWords = bleedStr.match(/\b\w+\b/g) || [];
    for (const word of allWords) {
      if (testedCandidates.has(word)) continue;
      if (details?.passwordLength && word.length !== details.passwordLength) continue;

      testedCandidates.add(word);
      const res = (await ns.dnet.authenticate(hostname, word)) as any;
      if (res?.success) {
        logger?.success(`🎉 Failsafe-Erfolg: ${word}`);
        return word;
      }
    }

    await ns.sleep(200);
  }

  logger?.error(`🔴 Kein Passwort auf ${hostname} isoliert.`);
  return null;
}