import { NS } from "@ns";
import { loadState } from "../core/state-manager.js";

export async function main(ns: NS): Promise<void> {
  const target = ns.getHostname();
  ns.disableLog("ALL");

  const SHARE_SCRIPT = "tasks/share.js";
  const GLOBAL_SHARE_POWER_CAP = 1.42;

  // Wenn der Server zu klein ist, gar nicht erst ausführen
  const maxRam = ns.getServerMaxRam(target);
  if (maxRam < 32) {
    ns.scriptKill(SHARE_SCRIPT, target);
    return;
  }

  while (true) {
    const state = loadState(ns);

    // 🛑 1. HARD STOP: Wenn JIT-Batcher oder MONEY-Sprint aktiv ist
    // Sofort Share killen, um RAM und CPU-Cycles für präzises HWGW freizugeben!
    if (state?.batcherActive === true || state?.strategy === "MONEY") {
      if (ns.scriptRunning(SHARE_SCRIPT, target)) {
        ns.scriptKill(SHARE_SCRIPT, target);
        ns.print(`⚠️ JIT/MONEY aktiv: Share-Filler gestoppt.`);
      }
      await ns.sleep(2000);
      continue;
    }

    // 📊 2. Share-Budget ermitteln
    const currentSharePower = ns.getSharePower();
    let allowedSharePercent = 0.0;

    if (state?.fillerConfig?.shareMaxRamPercent !== undefined) {
      allowedSharePercent = state.fillerConfig.shareMaxRamPercent;
    } else if (state?.strategy === "REP") {
      allowedSharePercent = 0.85; // Hohe Prio bei Rep-Grind
    } else {
      allowedSharePercent = 0.20; // Standard-Hintergrund-Share im Midgame
    }

    // Cap-Schutz: Wenn Share Power bereits hoch genug ist und wir nicht im REP-Modus sind
    if (currentSharePower >= GLOBAL_SHARE_POWER_CAP && state?.strategy !== "REP") {
      allowedSharePercent = 0.05;
    }

    // 🛡️ 3. Dynamische RAM-Berechnung
    const baseReserve = target === "home" ? Math.min(64, maxRam * 0.15) : 2;
    const scriptRam = ns.getScriptRam(SHARE_SCRIPT, target);
    const usedRam = ns.getServerUsedRam(target);

    // Threads ermitteln, die aktuell von share.js belegt werden
    const currentThreads = ns
      .ps(target)
      .filter((proc) => proc.filename.replace(/^\//, "") === SHARE_SCRIPT)
      .reduce((acc, proc) => acc + proc.threads, 0);

    // Verfügbares RAM berechnen (aktuell freies RAM + bereits genutztes Share-RAM - Reserve)
    const virtualFreeRam = maxRam - usedRam + currentThreads * scriptRam - baseReserve;

    let targetThreads = Math.max(0, Math.floor(virtualFreeRam / scriptRam));

    // Auf prozentuales Limit drosseln
    const maxAllowedShareRam = maxRam * allowedSharePercent;
    const threadCapByPercent = Math.floor(maxAllowedShareRam / scriptRam);
    targetThreads = Math.min(targetThreads, threadCapByPercent);

    // 🚀 4. Prozess-Anpassung (nur skalieren, wenn Abweichung > 10% oder Threads == 0)
    const threadDiff = Math.abs(targetThreads - currentThreads);
    if (
      targetThreads < currentThreads ||
      (targetThreads > currentThreads && (threadDiff > currentThreads * 0.10 || currentThreads === 0))
    ) {
      if (currentThreads > 0) ns.scriptKill(SHARE_SCRIPT, target);
      if (targetThreads > 0) {
        ns.exec(SHARE_SCRIPT, target, targetThreads);
      }
    }

    await ns.sleep(2000); // 2 Sek Intervall reicht völlig aus
  }
}