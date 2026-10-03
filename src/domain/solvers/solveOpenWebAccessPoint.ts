import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { DnetAuthAttemptState } from "/shared/types/network.js";
import { authenticateDnet } from "/infrastructure/runtime/dnet-state.js";

export async function solveOpenWebAccessPoint(
  ns: NS,
  hostname: string,
  details: any,
  logger?: LoggerClient,
  authAttemptState?: DnetAuthAttemptState,
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
        logger?.info("Passwort-Leak erkannt.");

        const res = await authenticateDnet(
          ns,
          hostname,
          candidate,
          authAttemptState,
        );
        if (res?.success) {
          logger?.success("🎉 Leak erfolgreich authentifiziert.");
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

        const res = await authenticateDnet(
          ns,
          hostname,
          candidate,
          authAttemptState,
        );
        if (res?.success) {
          logger?.success("🎉 Freitext-Match erfolgreich authentifiziert.");
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
      const res = await authenticateDnet(
        ns,
        hostname,
        word,
        authAttemptState,
      );
      if (res?.success) {
        logger?.success("🎉 Failsafe-Kandidat erfolgreich authentifiziert.");
        return word;
      }
    }

    await ns.sleep(200);
  }

  logger?.error(`🔴 Kein Passwort auf ${hostname} isoliert.`);
  return null;
}