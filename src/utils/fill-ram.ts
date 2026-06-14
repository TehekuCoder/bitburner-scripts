import { NS } from "@ns";
import { loadState } from "../core/state-manager.js";

export async function main(ns: NS): Promise<void> {
  const target = "home";
  ns.disableLog("ALL");

  const fillerScripts = ["../tasks/share.js", "../tasks/weaken-xp.js"];

  while (true) {
    // 1. SYSTEM-STATE ÜBERPRÜFEN
    const state = loadState(ns);
    const p = ns.getPlayer();

    let activeScript = "../tasks/share.js";

    // INTELLIGENTE WEICHE:
    // Wir nutzen share.js NUR, wenn das Hacking-Level reicht UND der Dispatcher aktiv Ruf farmt!
    if (p.skills.hacking < 250) {
      activeScript = "../tasks/weaken-xp.js";
    } else if (!state || state.strategy !== "REP") {
      // Wenn wir >= 250 sind, aber der Dispatcher Geld farmt oder trainiert: XP-Grind aktivieren!
      activeScript = "../tasks/weaken-xp.js";
    }

    // --- ANTI-LEAK-CLEANUP ---
    for (const fScript of fillerScripts) {
      if (fScript !== activeScript && ns.isRunning(fScript, target)) {
        ns.print(`[CLEANUP] Umstellung auf Effizienzmodus! Beende: ${fScript}`);
        ns.kill(fScript, target);
      }
    }

    const maxRam = ns.getServerMaxRam(target);
    const usedRam = ns.getServerUsedRam(target);
    const scriptRam = ns.getScriptRam(activeScript);

    // 2. DYNAMISCHE PRIORITÄTS-RESERVE
    let reserve = 32;
    if (ns.isRunning("core/sys-batcher.js", "home")) {
      reserve = Math.max(maxRam * 0.5, 128);
    }

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
        ns.kill(activeScript, target);
      }

      if (targetThreads > 0) {
        ns.print(
          `[RESOURCE] Allocate filler: ${targetThreads} Threads of ${activeScript} (Prio: LOW)`,
        );

        if (activeScript.includes("weaken")) {
          // DYNAMISCHE ZIELWAHL: Falls joesguns noch nicht existiert oder kein Root-Zugriff besteht, weichen wir auf foodnstuff aus
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
