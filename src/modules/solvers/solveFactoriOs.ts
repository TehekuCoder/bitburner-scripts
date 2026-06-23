import { NS } from "@ns";

export async function solveFactoriOs(
  ns: NS,
  host: string,
  details: any,
): Promise<string | null> {
  ns.print(`⚙️ Starte dynamisches Krypto-Sieb für Factori-Os auf ${host}...`);

  const len = details.passwordLength || 3;
  let candidates: number[] = [];

  // ⚡ FAST-PATH: Reiner Brute-Force für einstellige Passwörter (inklusive der 0!)
  if (len === 1) {
    ns.print(
      `⚡ [Factori-Os] Einstelliges Passwort erkannt. Überspringe Sieb, starte Blitz-Brute-Force...`,
    );
    candidates = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    for (const num of candidates) {
      const result = await ns.dnet.authenticate(host, num.toString());
      if (result && result.success) {
        ns.print(
          `🎉 [Factori-Os] Erfolg via Brute-Force! Passwort ist: ${num}`,
        );
        return num.toString();
      }
    }
    return null; // Wenn 0-9 nicht ging, ist etwas faul
  }

  // 📊 REGULÄRES SIEB: Für 2-stellige Nummern oder höher
  const min = Math.pow(10, len - 1); // z.B. bei Länge 3 -> 100
  const max = Math.pow(10, len) - 1; // z.B. bei Länge 3 -> 999

  ns.print(
    `📊 Passwort-Länge ist ${len}. Initialisiere Suchfenster: ${min} - ${max}`,
  );
  candidates = Array.from({ length: max - min + 1 }, (_, i) => i + min);

  while (candidates.length > 0) {
    const nextAttempt = candidates[0];

    ns.print(
      `[Factori-Os] Teste Zahl: ${nextAttempt} (Verbleibende Kandidaten: ${candidates.length})`,
    );
    const result = await ns.dnet.authenticate(host, nextAttempt.toString());

    if (result && result.success) {
      ns.print(`🎉 [Factori-Os] Erfolg! Passwort ist: ${nextAttempt}`);
      return nextAttempt.toString();
    }

    candidates = candidates.filter((num) => num !== nextAttempt);

    const bleedData = await ns.dnet.heartbleed(host);
    if (!bleedData || !bleedData.logs || bleedData.logs.length === 0) {
      continue;
    }

    const message = bleedData.logs[bleedData.logs.length - 1];
    const regex = /Password is (not )?divisible by '(\d+)'/;
    const match = message.match(regex);

    if (match) {
      const isNotDivisible = match[1] === "not ";
      const divisor = parseInt(match[2], 10);

      if (isNaN(divisor) || divisor === 0) {
        continue;
      }

      candidates = candidates.filter((num) => {
        const isDivisible = num % divisor === 0;
        return isNotDivisible ? !isDivisible : isDivisible;
      });
    }

    await ns.asleep(10);
  }

  return null;
}
