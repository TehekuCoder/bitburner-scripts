import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const target = ns.args[0] as string;

  if (!target || !ns.serverExists(target)) {
    ns.tprint(`ERROR: Ungültiges Ziel [${target}]. Nutzung: run work.ts [target]`);
    return;
  }

  ns.disableLog("ALL"); // BEHOBEN: Reaktiviert, um GUI-Lag bei hunderten Threads zu verhindern

  const maxMoney = ns.getServerMaxMoney(target);
  const minSecurity = ns.getServerMinSecurityLevel(target);

  if (maxMoney === 0) {
    ns.tprint(`ABORT: ${target} hat kein Geld und kann nicht gehackt werden.`);
    return;
  }

  const moneyThresh = maxMoney * 0.90;
  const securityThresh = minSecurity + 2;

  while (true) {
    try {
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
      // Falls der Server während eines Modus-Wechsels (z.B. Source-File-Mechaniken) zickt
      await ns.sleep(10000);
    }

    // Ein minimaler Sicherheits-Tick von 1ms reicht völlig aus, falls die API im Catch hakt
    await ns.sleep(1);
  }
}