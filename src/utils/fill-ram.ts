import { NS } from "@ns";
import { loadState } from "../core/state-manager.js";

export async function main(ns: NS): Promise<void> {
  const target = ns.getHostname();
  ns.disableLog("ALL");

  const fillerScripts = ["/tasks/share.js", "/tasks/xp-grind.js"];

  if (ns.getServerMaxRam(target) < 64) {
    ns.print(`[INFO] Server-RAM < 64GB. fill-ram bleibt inaktiv.`);
    for (const script of fillerScripts) {
      ns.scriptKill(script, target);
    }
    return;
  }

  // --- MATHEMATISCHE CONFIGS ---
  const GLOBAL_SHARE_POWER_CAP = 1.42; // Der magische Sweet-Spot (~44.000 Threads global)
  const MAX_USEFUL_HACK_LEVEL = 3000;  // Maximal benötigtes Level für das BitNode-Ende

  while (true) {
    const state = loadState(ns) as any;
    const p = ns.getPlayer();
    const currentSharePower = ns.getSharePower();

    let maxRam = ns.getServerMaxRam(target);
    if (target === "home") maxRam = Math.max(0, maxRam - 64);

    let allowedSharePercent = 0.0;
    let maxXpLevel = MAX_USEFUL_HACK_LEVEL;

    if (state?.fillerConfig) {
      allowedSharePercent = state.fillerConfig.shareMaxRamPercent;
      maxXpLevel = state.fillerConfig.maxXpLevel || MAX_USEFUL_HACK_LEVEL;
    } else if (state) {
      if (state.strategy === "REP") allowedSharePercent = 0.6; // Aggressiver im Rep-Modus
      else if (state.strategy === "MONEY") allowedSharePercent = 0.1;
    }

    // 🛑 MATHEMATISCHER SHARE-STOPP: Wenn das Netzwerk das Cap erreicht hat, drosseln wir lokal!
    if (currentSharePower >= GLOBAL_SHARE_POWER_CAP && state?.strategy !== "REP") {
      allowedSharePercent = 0.02; // Nur noch eine minimale Erhaltungsdosis RAM erlauben
    }

    let activeScript = "";
    let targetThreads = 0;

    const isBatcherActive = 
      state?.strategy === "MONEY" || 
      (state?.batcherRamNeeded && state.batcherRamNeeded > 0);

    // A: XP-Grind Logik mit smarter Cap-Bremse
    if (
      p.skills.hacking < maxXpLevel &&
      p.skills.hacking < MAX_USEFUL_HACK_LEVEL && // Absolutes mathematisches Limit
      state?.strategy !== "MONEY" &&               // Wenn Geld läuft, hat XP-Grind Feierabend
      (state?.strategy === "XP_SPRINT" || p.skills.hacking < 250)
    ) {
      activeScript = "/tasks/xp-grind.js";

      const usedRam = ns.getServerUsedRam(target);
      const scriptRam = ns.getScriptRam(activeScript, target);
      const currentThreads = ns.ps(target)
        .filter((proc) => proc.filename === activeScript)
        .reduce((acc, proc) => acc + proc.threads, 0);

      let reserve = 64;
      if (isBatcherActive) {
        const dynamicNeeded = state?.batcherRamNeeded ? state.batcherRamNeeded + 4 : 40;
        reserve = Math.max(dynamicNeeded, Math.floor(maxRam * 0.3));
      }

      const availableRam = maxRam - (usedRam - currentThreads * scriptRam) - reserve;
      targetThreads = Math.floor(availableRam / scriptRam);
    }
    // B: Share-Logik
    else if (allowedSharePercent > 0) {
      activeScript = "/tasks/share.js";
      const scriptRam = ns.getScriptRam(activeScript, target);

      const maxAllowedShareRam = maxRam * allowedSharePercent;
      targetThreads = Math.floor(maxAllowedShareRam / scriptRam);

      const usedRam = ns.getServerUsedRam(target);
      const currentThreads = ns.ps(target)
        .filter((proc) => proc.filename === activeScript)
        .reduce((acc, proc) => acc + proc.threads, 0);

      const shareReserve = isBatcherActive
        ? (state?.batcherRamNeeded ? state.batcherRamNeeded + 4 : 40)
        : 32;

      const physicalAvailableRam = maxRam - (usedRam - currentThreads * scriptRam) - shareReserve;
      const physicalMaxThreads = Math.floor(physicalAvailableRam / scriptRam);

      targetThreads = Math.min(targetThreads, physicalMaxThreads);
    }

    if (targetThreads < 0) targetThreads = 0;

    // --- ANTI-LEAK-CLEANUP & SCALING ---
    for (const fScript of fillerScripts) {
      if (fScript !== activeScript && ns.isRunning(fScript, target)) {
        ns.scriptKill(fScript, target);
      }
    }

    if (activeScript !== "") {
      const currentThreads = ns.ps(target)
        .filter((proc) => proc.filename === activeScript)
        .reduce((acc, proc) => acc + proc.threads, 0);

      const threadDiff = Math.abs(targetThreads - currentThreads);
      const shouldScaleDown = targetThreads < currentThreads;
      const shouldScaleUp = targetThreads > currentThreads && (threadDiff > currentThreads * 0.1 || currentThreads === 0);

      if (shouldScaleDown || shouldScaleUp) {
        if (currentThreads > 0) ns.scriptKill(activeScript, target);
        if (targetThreads > 0) {
          if (activeScript === "/tasks/xp-grind.js") {
            const xpTarget = ns.serverExists("joesguns") && ns.hasRootAccess("joesguns") ? "joesguns" : "foodnstuff";
            ns.exec(activeScript, target, targetThreads, xpTarget, 0, Math.random());
          } else {
            ns.exec(activeScript, target, targetThreads);
          }
        }
      }
    }

    await ns.sleep(1500);
  }
}