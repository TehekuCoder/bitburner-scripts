import { NS } from "@ns";
import { loadState } from "../core/state-manager.js";

export async function main(ns: NS): Promise<void> {
  const target = "home";
  ns.disableLog("ALL");

  // 🔥 EARLY-GAME SCHUTZRIEGEL (Jetzt mit absoluten Pfaden beim Cleanup)
  if (ns.getServerMaxRam(target) < 128) {
    ns.print(`[INFO] Home-RAM < 128GB. fill-ram wird deaktiviert.`);
    ns.scriptKill("/tasks/share.js", target);
    ns.scriptKill("/tasks/weaken-xp.js", target);
    return;
  }

  // SÄMTLICHE PFADE MIT FÜHRENDEM SLOPE FIERSENTLICH ABSOLUT!
  const fillerScripts = ["/tasks/share.js", "/tasks/weaken-xp.js"];

  while (true) {
    // 1. SYSTEM-STATE ÜBERPRÜFEN
    const state = loadState(ns);
    const p = ns.getPlayer();

    let activeScript = "/tasks/share.js";

    // INTELLIGENTE WEICHE
    if (p.skills.hacking < 250) {
      activeScript = "/tasks/weaken-xp.js";
    } else if (!state || state.strategy !== "REP") {
      activeScript = "/tasks/weaken-xp.js";
    }

    // --- ANTI-LEAK-CLEANUP ---
    for (const fScript of fillerScripts) {
      if (fScript !== activeScript && ns.isRunning(fScript, target)) {
        ns.print(`[CLEANUP] Umstellung! Beende alten Filler: ${fScript}`);
        ns.scriptKill(fScript, target);
      }
    }

    const maxRam = ns.getServerMaxRam(target);
    const usedRam = ns.getServerUsedRam(target);
    const scriptRam = ns.getScriptRam(activeScript);

    // 2. DYNAMISCHE PRIORITÄTS-RESERVE (PROAKTIV STATT REAKTIV)
    let reserve = 32;

    // Wenn der Dispatcher auf MONEY (Batcher) schaltet ODER der Batcher schon läuft:
    // Weiche komplett zurück! Ein HWGW-Batcher braucht jeden Thread RAM für seine Hacks/Grows/Weakens.
    const isBatcherMode =
      state?.strategy === "MONEY" ||
      ns.isRunning("/core/sys-batcher.js", target);

    if (isBatcherMode) {
      // Bei 128GB RAM setzt das die Reserve auf exakt 128GB -> Filler stoppt komplett!
      reserve = Math.max(maxRam * 0.3, 128);
    }

    const currentThreads = ns
      .ps(target)
      .filter((p) => p.filename === activeScript)
      .reduce((acc, p) => acc + p.threads, 0);

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
          `[RESOURCE] Allocate filler: ${targetThreads} Threads of ${activeScript} (Reserve: ${reserve}GB)`,
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
