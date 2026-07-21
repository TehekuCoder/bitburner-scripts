import { NS } from "@ns";

export async function solveOpenWebAccessPoint(
  ns: NS,
  hostname: string,
  details: any,
): Promise<string | null> {
  const escapedHost = hostname.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  const leakRegex = new RegExp(`${escapedHost}:(\\w+)`, "i");

  // Speichert bereits getestete Wörter, um Mehrfachprüfungen zu vermeiden
  const testedCandidates = new Set<string>();

  for (let i = 0; i < 5; i++) {
    const bleed = (await ns.dnet.heartbleed(hostname)) as any;
    const bleedStr = typeof bleed === "string" ? bleed : JSON.stringify(bleed);

    // 1. Direktes Leak-Muster (hostname:PASSWORT)
    const leakMatch = bleedStr.match(leakRegex);
    if (leakMatch && leakMatch[1]) {
      const candidate = leakMatch[1];
      if (!testedCandidates.has(candidate)) {
        testedCandidates.add(candidate);
        ns.print(`[OWAP] Leak erkannt: ${candidate}`);

        const res = (await ns.dnet.authenticate(hostname, candidate)) as any;
        if (res?.success) return candidate;
      }
    }

    // 2. Freitext-Muster (password is: XYZ)
    const exactMatch = bleedStr.match(/password\s*is\s*[:=]\s*(\w+)/i);
    if (exactMatch && exactMatch[1]) {
      const candidate = exactMatch[1];
      if (!testedCandidates.has(candidate)) {
        testedCandidates.add(candidate);

        const res = (await ns.dnet.authenticate(hostname, candidate)) as any;
        if (res?.success) return candidate;
      }
    }

    // 3. Fallback: Speicher-Crawl ohne Duplikate
    const allWords = bleedStr.match(/\b\w+\b/g) || [];
    for (const word of allWords) {
      if (testedCandidates.has(word)) continue;
      if (details?.passwordLength && word.length !== details.passwordLength) continue;

      testedCandidates.add(word);
      const res = (await ns.dnet.authenticate(hostname, word)) as any;
      if (res?.success) {
        ns.print(`🎉 [OWAP] Failsafe-Erfolg: ${word}`);
        return word;
      }
    }

    await ns.sleep(200);
  }

  ns.print(`🔴 [OWAP] Kein Passwort auf ${hostname} isoliert.`);
  return null;
}