import { NS } from "@ns";

/**
 * Konvertiert eine römische Zahl in eine arabische Zahl.
 */
function romanToArabic(roman: string): number {
  const vals: Record<string, number> = {
    I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
  };
  let total = 0;
  const str = roman.toUpperCase();

  for (let i = 0; i < str.length; i++) {
    const cur = vals[str[i]] || 0;
    const next = vals[str[i + 1]] || 0;

    if (next > cur) {
      total += next - cur;
      i++; // Nächstes Zeichen überspringen
    } else {
      total += cur;
    }
  }

  return total;
}

export async function solveRoman(
  ns: NS,
  host: string,
  details: any,
): Promise<string | null> {
  const rawText = String(details?.data || details?.passwordHint || "").trim();

  if (!rawText) {
    ns.print(`🔴 [Roman] Kein Text/Hint auf ${host} übergeben.`);
    return null;
  }

  // Römische Zahlenblöcke aus dem Text extrahieren
  const matches = rawText.match(/[IVXLCDM]+/gi) || [];

  for (const romanSeq of matches) {
    const arabicValue = romanToArabic(romanSeq);
    if (arabicValue <= 0) continue;

    const guess = arabicValue.toString();
    const res = (await ns.dnet.authenticate(host, guess)) as any;

    if (res?.success) {
      ns.print(`🎉 [Roman] Römische Zahl '${romanSeq}' als '${guess}' aufgelöst!`);
      return guess;
    }
  }

  ns.print(`🔴 [Roman] Keine passende römische Zahl in "${rawText}" gefunden.`);
  return null;
}