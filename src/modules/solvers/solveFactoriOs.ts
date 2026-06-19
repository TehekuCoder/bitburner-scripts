import { NS } from "@ns";

export async function solveFactoriOs(ns: NS, host: string, details: any): Promise<string | null> {
  ns.print(`⚙️ Starte mathematisches Krypto-Sieb für Factori-Os auf ${host}...`);

  let candidates: number[] = Array.from({ length: 2000 }, (_, i) => i + 1);

  while (candidates.length > 0) {
    const nextAttempt = candidates[0];
    
    ns.print(`[Factori-Os] Teste Zahl: ${nextAttempt} (Verbleibende Kandidaten: ${candidates.length})`);
    const result = await ns.dnet.authenticate(host, nextAttempt.toString());

    if (result && result.success) {
      ns.print(`🎉 [Factori-Os] Erfolg! Passwort ist: ${nextAttempt}`);
      return nextAttempt.toString();
    }

    candidates = candidates.filter(num => num !== nextAttempt);

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

      candidates = candidates.filter(num => {
        const isDivisible = (num % divisor === 0);
        return isNotDivisible ? !isDivisible : isDivisible;
      });
    }

    await ns.asleep(10);
  }

  return null;
}