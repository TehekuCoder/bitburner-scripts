import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const target = ns.args[0] as string;

  if (!target || !ns.serverExists(target)) {
    ns.tprint(`ERROR: Ungültiges Ziel [${target}]. Nutzung: run work.ts [target]`);
    return;
  }

  // ns.disableLog("ALL"); // Schont die System-Performance bei vielen Threads

  const maxMoney = ns.getServerMaxMoney(target);
  const minSecurity = ns.getServerMinSecurityLevel(target);

  if (maxMoney === 0) {
    ns.tprint(`ABORT: ${target} hat kein Geld und kann nicht gehackt werden.`);
    return;
  }

  // TUNING: Höheres Geld-Limit und schärfere Security-Grenze für mehr Profit im Mid-Game
  const moneyThresh = maxMoney * 0.90;
  const securityThresh = minSecurity + 2;

  while (true) {
    try {
      const currentSecurity = ns.getServerSecurityLevel(target);
      const currentMoney = ns.getServerMoneyAvailable(target);

      if (currentSecurity > securityThresh) {
        // Hält die Server-Security permanent am Boden
        await ns.weaken(target);
      } else if (currentMoney < moneyThresh) {
        // Schnelles, aggressives Auffüllen, da wir nur 10% abgeschöpft haben
        await ns.grow(target);
      } else {
        // Maximaler Ertrag bei minimaler Security
        await ns.hack(target);
      }
    } catch (e: unknown) {
      ns.print(`Warnung: Fehler bei der Kommunikation mit ${target}. Reconnect in 10s...`);
      await ns.sleep(10000);
    }

    await ns.sleep(10);
  }
}