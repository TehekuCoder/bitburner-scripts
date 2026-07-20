import { NS } from "@ns";
import { patchState } from "./state-manager.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const target = (ns.args[0] as string) || "n00dles";

  while (true) {
    if (!ns.serverExists(target) || !ns.hasRootAccess(target)) {
      ns.print(`⚠️ Ziel [${target}] nicht erreichbar/gehackt.`);
      await ns.sleep(5000);
      continue;
    }

    const curSec = ns.getServerSecurityLevel(target);
    const minSec = ns.getServerMinSecurityLevel(target);
    const curMoney = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);

    const moneyPct = maxMoney > 0 ? ((curMoney / maxMoney) * 100).toFixed(1) : "100";
    const secDelta = (curSec - minSec).toFixed(2);

    // 1. Sicherheit zu hoch -> WEAKEN
    if (curSec > minSec + 3) {
      patchState(ns, {
        batcherTarget: target,
        batcherProgress: `EHT-WEAKEN (Sec: +${secDelta})`,
      });
      await ns.weaken(target);
    } 
    // 2. Geld zu niedrig -> GROW
    else if (curMoney < maxMoney * 0.75) {
      patchState(ns, {
        batcherTarget: target,
        batcherProgress: `EHT-GROW (${moneyPct}%)`,
      });
      await ns.grow(target);
    } 
    // 3. Optimaler Zustand -> HACK
    else {
      patchState(ns, {
        batcherTarget: target,
        batcherProgress: `EHT-HACKING...`,
      });
      await ns.hack(target);
    }

    await ns.sleep(200);
  }
}