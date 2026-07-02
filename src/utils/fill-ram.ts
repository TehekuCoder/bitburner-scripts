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

  const GLOBAL_SHARE_POWER_CAP = 1.42;
  const MAX_USEFUL_HACK_LEVEL = 3000;

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
      if (state.strategy === "REP") allowedSharePercent = 0.6;
      else if (state.strategy === "MONEY") allowedSharePercent = 0.1;
    }

    if (
      currentSharePower >= GLOBAL_SHARE_POWER_CAP &&
      state?.strategy !== "REP"
    ) {
      allowedSharePercent = 0.02;
    }

    let activeScript = "";
    let targetThreads = 0;

    const isBatcherActive =
      state?.strategy === "MONEY" ||
      (state?.batcherRamNeeded && state.batcherRamNeeded > 0);

    // A: XP-Grind Logik
    if (
      p.skills.hacking < maxXpLevel &&
      p.skills.hacking < MAX_USEFUL_HACK_LEVEL &&
      state?.strategy !== "MONEY" &&
      (state?.strategy === "XP_SPRINT" || p.skills.hacking < 250)
    ) {
      activeScript = "/tasks/xp-grind.js";

      const usedRam = ns.getServerUsedRam(target);
      const scriptRam = ns.getScriptRam(activeScript, target);

      // 🔥 FIX 1: Pfad-Normalisierung mit Regex, um Schrägstriche zu ignorieren
      const currentThreads = ns
        .ps(target)
        .filter(
          (proc) =>
            proc.filename.replace(/^\//, "") ===
            activeScript.replace(/^\//, ""),
        )
        .reduce((acc, proc) => acc + proc.threads, 0);

      let reserve = 64;
      if (isBatcherActive) {
        const dynamicNeeded = state?.batcherRamNeeded
          ? state.batcherRamNeeded + 4
          : 40;
        reserve = Math.max(dynamicNeeded, Math.floor(maxRam * 0.3));
      }

      const availableRam =
        maxRam - (usedRam - currentThreads * scriptRam) - reserve;
      targetThreads = Math.floor(availableRam / scriptRam);
    }
    // B: Share-Logik
    else if (allowedSharePercent > 0) {
      activeScript = "/tasks/share.js";
      const scriptRam = ns.getScriptRam(activeScript, target);

      const maxAllowedShareRam = maxRam * allowedSharePercent;
      targetThreads = Math.floor(maxAllowedShareRam / scriptRam);

      const usedRam = ns.getServerUsedRam(target);

      // 🔥 FIX 2: Pfad-Normalisierung hier ebenfalls einbauen
      const currentThreads = ns
        .ps(target)
        .filter(
          (proc) =>
            proc.filename.replace(/^\//, "") ===
            activeScript.replace(/^\//, ""),
        )
        .reduce((acc, proc) => acc + proc.threads, 0);

      const shareReserve = isBatcherActive
        ? state?.batcherRamNeeded
          ? state.batcherRamNeeded + 4
          : 40
        : 32;

      const physicalAvailableRam =
        maxRam - (usedRam - currentThreads * scriptRam) - shareReserve;
      const physicalMaxThreads = Math.floor(physicalAvailableRam / scriptRam);

      targetThreads = Math.min(targetThreads, physicalMaxThreads);
    }

    if (targetThreads < 0) targetThreads = 0;

    // --- ANTI-LEAK-CLEANUP & SCALING ---
    for (const fScript of fillerScripts) {
      // 🔥 FIX 3: Auch beim generellen Cleanup Schrägstriche normalisieren
      const isRunningNormalized = ns
        .ps(target)
        .some(
          (p) => p.filename.replace(/^\//, "") === fScript.replace(/^\//, ""),
        );
      if (fScript !== activeScript && isRunningNormalized) {
        ns.scriptKill(fScript, target);
      }
    }

    if (activeScript !== "") {
      // 🔥 FIX 4: Letzte Instanz-Prüfung vor dem eigentlichen Skript-Skalieren
      const currentThreads = ns
        .ps(target)
        .filter(
          (proc) =>
            proc.filename.replace(/^\//, "") ===
            activeScript.replace(/^\//, ""),
        )
        .reduce((acc, proc) => acc + proc.threads, 0);

      const threadDiff = Math.abs(targetThreads - currentThreads);
      const shouldScaleDown = targetThreads < currentThreads;
      const shouldScaleUp =
        targetThreads > currentThreads &&
        (threadDiff > currentThreads * 0.1 || currentThreads === 0);

      if (shouldScaleDown || shouldScaleUp) {
        if (currentThreads > 0) ns.scriptKill(activeScript, target);
        if (targetThreads > 0) {
          if (activeScript === "/tasks/xp-grind.js") {
            const xpTarget =
              ns.serverExists("joesguns") && ns.hasRootAccess("joesguns")
                ? "joesguns"
                : "foodnstuff";
            ns.exec(
              activeScript,
              target,
              targetThreads,
              xpTarget,
              0,
              Math.random(),
            );
          } else {
            ns.exec(activeScript, target, targetThreads);
          }
        }
      }
    }

    await ns.sleep(1500);
  }
}
