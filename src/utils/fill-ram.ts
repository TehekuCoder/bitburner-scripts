import { NS } from "@ns";
import { loadState, BotState } from "../core/state-manager.js";

export async function main(ns: NS): Promise<void> {
  const target = ns.getHostname();
  ns.disableLog("ALL");

  const fillerScripts = ["/tasks/share.js", "/tasks/xp-grind.js"];

  // Mindestanforderung prüfen
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
    const state: BotState | null = loadState(ns);
    const p = ns.getPlayer();
    const currentSharePower = ns.getSharePower();

    const maxRam = ns.getServerMaxRam(target);
    let allowedSharePercent = 0.0;
    let maxXpLevel = MAX_USEFUL_HACK_LEVEL;

    // Strategie auswerten
    if (state?.fillerConfig) {
      allowedSharePercent = state.fillerConfig.shareMaxRamPercent;
      maxXpLevel = state.fillerConfig.maxXpLevel || MAX_USEFUL_HACK_LEVEL;
    } else if (state) {
      if (state.strategy === "REP") allowedSharePercent = 0.6;
      else if (state.strategy === "MONEY") allowedSharePercent = 0.1;
    }

    // Share-Cap Absicherung
    if (
      currentSharePower >= GLOBAL_SHARE_POWER_CAP &&
      state?.strategy !== "REP"
    ) {
      allowedSharePercent = 0.02;
    }

    let activeScript = "";
    let targetThreads = 0;

    // IN DER WHILE-LOOP VON FILL-RAM.TS
    const isBatcherActive =
      state?.strategy === "MONEY" ||
      (state?.batcherRamNeeded && state.batcherRamNeeded > 0);

    // --- EINHEITLICHE RAM-RESERVIERUNG ---
    let baseReserve = 0;
    const currentRamUsedByOtherThings = ns.getServerUsedRam(target);
    const batcherRamReservation = state?.batcherRamNeeded
      ? state.batcherRamNeeded + 4
      : 40;

    if (target === "home") {
      // 1. Home-Server: Ein fester Basis-Schutzpuffer (32GB) + Batcher-Bedarf falls aktiv
      baseReserve = 32;
      if (isBatcherActive) {
        baseReserve += batcherRamReservation;
      }
    } else {
      // 2. P-Server (Gekaufte Server):
      if (isBatcherActive) {
        // Festgelegter 40% Block für den Batcher, 60% stehen für Shares/XP offen
        baseReserve = Math.floor(maxRam * 0.4);
      } else {
        // Standard-Puffer für spontane Worker-Dispatches wenn kein Batcher läuft
        baseReserve = 32;
      }
    }
    // -------------------------------------

    // A: XP-Grind Logik
    if (
      p.skills.hacking < maxXpLevel &&
      // ... hier geht dein Skript ganz normal weiter
      p.skills.hacking < MAX_USEFUL_HACK_LEVEL &&
      state?.strategy !== "MONEY" &&
      (state?.strategy === "XP_SPRINT" || p.skills.hacking < 250)
    ) {
      activeScript = "/tasks/xp-grind.js";
      const scriptRam = ns.getScriptRam(activeScript, target);
      const usedRam = ns.getServerUsedRam(target);

      const currentThreads = ns
        .ps(target)
        .filter(
          (proc) =>
            proc.filename.replace(/^\//, "") ===
            activeScript.replace(/^\//, ""),
        )
        .reduce((acc, proc) => acc + proc.threads, 0);

      // Freies RAM berechnen unter Berücksichtigung der aktiven Threads dieses Skripts
      const availableRam =
        maxRam - (usedRam - currentThreads * scriptRam) - baseReserve;
      targetThreads = Math.floor(availableRam / scriptRam);
    }
    // B: Share-Logik
    else if (allowedSharePercent > 0) {
      activeScript = "/tasks/share.js";
      const scriptRam = ns.getScriptRam(activeScript, target);

      // Prozentual erlaubtes RAM berechnen
      const maxAllowedShareRam = maxRam * allowedSharePercent;
      targetThreads = Math.floor(maxAllowedShareRam / scriptRam);

      const usedRam = ns.getServerUsedRam(target);

      const currentThreads = ns
        .ps(target)
        .filter(
          (proc) =>
            proc.filename.replace(/^\//, "") ===
            activeScript.replace(/^\//, ""),
        )
        .reduce((acc, proc) => acc + proc.threads, 0);

      // Physikalische Obergrenze durch den berechneten Systempuffer prüfen
      const physicalAvailableRam =
        maxRam - (usedRam - currentThreads * scriptRam) - baseReserve;
      const physicalMaxThreads = Math.floor(physicalAvailableRam / scriptRam);

      targetThreads = Math.min(targetThreads, physicalMaxThreads);
    }

    if (targetThreads < 0) targetThreads = 0;

    // --- ANTI-LEAK-CLEANUP ---
    for (const fScript of fillerScripts) {
      const isRunningNormalized = ns
        .ps(target)
        .some(
          (p) => p.filename.replace(/^\//, "") === fScript.replace(/^\//, ""),
        );

      if (fScript !== activeScript && isRunningNormalized) {
        ns.scriptKill(fScript, target);
      }
    }

    // --- EXECUTION & HYSTERESE SCALING ---
    if (activeScript !== "") {
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
