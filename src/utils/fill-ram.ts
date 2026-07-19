import { NS } from "@ns";
import { loadState } from "../core/state-manager.js";
import { BotState } from "/core/types.js";

export async function main(ns: NS): Promise<void> {
  const target = ns.getHostname();
  ns.disableLog("ALL");

  const fillerScripts = ["tasks/share.js", "tasks/xp-grind.js"];
  const maxRam = ns.getServerMaxRam(target);

  if (maxRam < 64) {
    for (const script of fillerScripts) ns.scriptKill(script, target);
    return;
  }

  const GLOBAL_SHARE_POWER_CAP = 1.42;
  const MAX_USEFUL_HACK_LEVEL = 3000;

  while (true) {
    const state: BotState | null = loadState(ns);
    
    // 🛑 ERWEITERTER SOFORT-ABBRUCH: Wenn MONEY läuft ODER der Batcher aktiv ist, 
    // räumt der Filler sofort das Feld, um die präzisen Batch-Timings nicht zu stören!
    if (state?.strategy === "MONEY" || state?.batcherActive === true) {
      let killedAnything = false;
      for (const script of fillerScripts) {
        if (ns.scriptRunning(script, target)) {
          ns.scriptKill(script, target);
          killedAnything = true;
        }
      }
      if (killedAnything) {
        ns.print(`⚠️ JIT-Batcher aktiv oder MONEY-Sprint. Filler deaktiviert.`);
      }
      // Wenn der Batcher läuft, schlafen wir 2 Sekunden, um den Dispatcher-Takt zu matchen
      await ns.sleep(2000);
      continue;
    }

    const p = ns.getPlayer();
    const currentSharePower = ns.getSharePower();

    const activeProcesses = ns.ps(target).map((proc) => ({
      ...proc,
      normalizedName: proc.filename.replace(/^\//, ""),
    }));

    let allowedSharePercent = 0.0;
    let maxXpLevel = MAX_USEFUL_HACK_LEVEL;

    if (state?.fillerConfig) {
      allowedSharePercent = state.fillerConfig.shareMaxRamPercent;
      maxXpLevel = state.fillerConfig.maxXpLevel || MAX_USEFUL_HACK_LEVEL;
    } else if (state) {
      if (state.strategy === "REP") allowedSharePercent = 0.85; 
    }

    if (currentSharePower >= GLOBAL_SHARE_POWER_CAP && state?.strategy !== "REP") {
      allowedSharePercent = 0.02;
    }

    // 🛡️ DYNAMISCHE RESERVIERUNG
    let baseReserve = target === "home" ? Math.min(64, maxRam * 0.2) : 2; 

    let activeScript = "";
    if (p.skills.hacking < maxXpLevel && (state?.strategy === "XP_SPRINT" || p.skills.hacking < 250)) {
      activeScript = "tasks/xp-grind.js";
    } else if (allowedSharePercent > 0) {
      activeScript = "tasks/share.js";
    }

    // Inaktive Filler terminieren
    for (const fScript of fillerScripts) {
      if (fScript !== activeScript && activeProcesses.some(proc => proc.normalizedName === fScript)) {
        ns.scriptKill(fScript, target);
      }
    }

    if (activeScript !== "") {
      const scriptRam = ns.getScriptRam(activeScript, target);
      const usedRam = ns.getServerUsedRam(target);
      const currentThreads = activeProcesses
        .filter((proc) => proc.normalizedName === activeScript)
        .reduce((acc, proc) => acc + proc.threads, 0);

      const virtualFreeRam = maxRam - usedRam + (currentThreads * scriptRam) - baseReserve;
      let targetThreads = Math.max(0, Math.floor(virtualFreeRam / scriptRam));

      if (activeScript === "tasks/share.js") {
        const maxAllowedShareRam = maxRam * allowedSharePercent;
        const threadCapByPercent = Math.floor(maxAllowedShareRam / scriptRam);
        targetThreads = Math.min(targetThreads, threadCapByPercent);
      }

      const threadDiff = Math.abs(targetThreads - currentThreads);
      if (targetThreads < currentThreads || (targetThreads > currentThreads && (threadDiff > currentThreads * 0.05 || currentThreads === 0))) {
        if (currentThreads > 0) ns.scriptKill(activeScript, target);
        if (targetThreads > 0) {
          if (activeScript === "tasks/xp-grind.js") {
            const xpTarget = ns.serverExists("joesguns") && ns.hasRootAccess("joesguns") ? "joesguns" : "foodnstuff";
            ns.exec(activeScript, target, targetThreads, xpTarget, 0, Math.random());
          } else {
            ns.exec(activeScript, target, targetThreads);
          }
        }
      }
    }

    await ns.sleep(1000);
  }
}