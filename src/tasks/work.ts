import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const target = ns.args[0] as string;

  if (!target || !ns.serverExists(target)) {
    ns.tprint(`ERROR: Ungültiges Ziel [${target}]. Nutzung: run work.ts [target]`);
    return;
  }

  ns.disableLog("ALL");

  const maxMoney = ns.getServerMaxMoney(target);
  const minSecurity = ns.getServerMinSecurityLevel(target);

  if (maxMoney === 0) {
    ns.tprint(`ABORT: ${target} hat kein Geld und kann nicht gehackt werden.`);
    return;
  }

  // Schwellenwerte für optimale Ausbeute im Early/Mid-Game
  const moneyThresh = maxMoney * 0.90;
  const securityThresh = minSecurity + 2;

  while (true) {
    try {
      // Sicherheits-Check falls Root-Zugriff im Loop flöten geht (z.B. BN-Mechaniken)
      if (!ns.hasRootAccess(target)) {
        await ns.sleep(5000);
        continue;
      }

      const currentSecurity = ns.getServerSecurityLevel(target);
      const currentMoney = ns.getServerMoneyAvailable(target);

      if (currentSecurity > securityThresh) {
        await ns.weaken(target);
      } else if (currentMoney < moneyThresh) {
        await ns.grow(target);
      } else {
        await ns.hack(target);
      }
    } catch (e: unknown) {
      await ns.sleep(5000);
    }
    await ns.sleep(1);
  }
}