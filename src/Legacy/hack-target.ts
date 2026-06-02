import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  // 1. INITIALISIERUNG & VALIDIERUNG
  const target = ns.args[0] as string;

  if (!target) {
    ns.tprint("❌ FEHLER: Kein Ziel-Server angegeben!");
    ns.tprint("Nutzung: run hack-target.ts [target]");
    return;
  }

  if (!ns.serverExists(target)) {
    ns.tprint(`❌ FEHLER: Der Server '${target}' existiert nicht im Netzwerk.`);
    return;
  }

  ns.tprint(`🚀 Angriff auf ${target} gestartet...`);

  // 2. ANALYSE-PHASE
  let moneyThresh: number;
  let securityThresh: number;

  try {
    const maxMoney = ns.getServerMaxMoney(target);
    const minSecurity = ns.getServerMinSecurityLevel(target);

    if (maxMoney === 0) {
      ns.tprint(`⚠️ FATAL: ${target} hat kein Geld-Vorkommen.`);
      return;
    }

    moneyThresh = maxMoney * 0.75;
    securityThresh = minSecurity + 5;
  } catch (e: unknown) {
    ns.tprint(`⚠️ FATAL: Analyse von ${target} fehlgeschlagen.`);
    return;
  }

  // 3. MAIN LOOP
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
      ns.print(`Verbindung zu ${target} instabil. Re-initialisiere...`);
      await ns.sleep(5000);
    }

    await ns.sleep(10);
  }
}