import { NS } from "@ns";
import { loadState } from "../core/state-manager.js";

export async function main(ns: NS): Promise<void> {
  const target = "home";
  ns.disableLog("ALL");

  // 🔥 NEU: EARLY-GAME SCHUTZRIEGEL
  // Wenn wir weniger als 128 GB RAM haben, ist fill-ram kontraproduktiv.
  // Wir beenden das Skript sofort, damit Core-Dienste wie 'crime' Atmen können.
  if (ns.getServerMaxRam(target) < 128) {
    ns.print(`[INFO] Home-RAM < 128GB (Legacy Mode). fill-ram wird deaktiviert.`);
    
    // Cleanup: Falls noch alte Reste laufen, killen wir sie vor dem Exit
    ns.scriptKill("tasks/share.js", target);
    ns.scriptKill("tasks/weaken-xp.js", target);
    return; 
  }

  // FIX: Absolute Pfade nutzen, da ns.ps() relative Pfadangaben wie "../" verwirft!
  const fillerScripts = ["tasks/share.js", "tasks/weaken-xp.js"];

  while (true) {
    // 1. SYSTEM-STATE ÜBERPRÜFEN
    const state = loadState(ns);
    const p = ns.getPlayer();

    let activeScript = "tasks/share.js";

    // INTELLIGENTE WEICHE
    if (p.skills.hacking < 250) {
      activeScript = "tasks/weaken-xp.js";
    } else if (!state || state.strategy !== "REP") {
      activeScript = "tasks/weaken-xp.js";
    }

    // --- ANTI-LEAK-CLEANUP ---
    for (const fScript of fillerScripts) {
      if (fScript !== activeScript && ns.isRunning(fScript, target)) {
        ns.print(`[CLEANUP] Umstellung auf Effizienzmodus! Beende: ${fScript}`);
        ns.scriptKill(fScript, target);
      }
    }

    const maxRam = ns.getServerMaxRam(target);
    const usedRam = ns.getServerUsedRam(target);
    const scriptRam = ns.getScriptRam(activeScript);

    // 2. DYNAMISCHE PRIORITÄTS-RESERVE
    let reserve = 32;
    if (ns.isRunning("core/sys-batcher.js", "home")) {
      reserve = Math.max(maxRam * 0.3, 128);
    }

    // FIX: Findet den Prozess jetzt fehlerfrei, da die Pfadformate übereinstimmen
    const fillerProc = ns.ps(target).find((p) => p.filename === activeScript);
    const currentThreads = fillerProc ? fillerProc.threads : 0;

    const availableRam =
      maxRam - (usedRam - currentThreads * scriptRam) - reserve;
    let targetThreads = Math.floor(availableRam / scriptRam);
    if (targetThreads < 0) targetThreads = 0;

    // 3. ANPASSUNGS-LOGIK
    const threadDiff = Math.abs(targetThreads - currentThreads);
    const shouldScaleDown = targetThreads < currentThreads;
    const shouldScaleUp =
      targetThreads > currentThreads && threadDiff > currentThreads * 0.1;

    if (
      targetThreads !== currentThreads &&
      (shouldScaleDown || shouldScaleUp || currentThreads === 0)
    ) {
      if (currentThreads > 0) {
        ns.scriptKill(activeScript, target);
      }

      if (targetThreads > 0) {
        ns.print(
          `[RESOURCE] Allocate filler: ${targetThreads} Threads of ${activeScript} (Prio: LOW)`,
        );

        if (activeScript.includes("weaken")) {
          const weakenTarget =
            ns.serverExists("joesguns") && ns.hasRootAccess("joesguns")
              ? "joesguns"
              : "foodnstuff";

          ns.exec(
            activeScript,
            target,
            targetThreads,
            weakenTarget,
            0,
            Math.random(),
          );
        } else {
          ns.exec(activeScript, target, targetThreads);
        }
      }
    }

    await ns.sleep(10000);
  }
}