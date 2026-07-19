import { NS } from "@ns";
import { loadState } from "../core/state-manager.js";
import { BotState } from "/core/types.js";

export async function main(ns: NS): Promise<void> {
  const target = ns.getHostname();
  ns.disableLog("ALL");

  // Pfade pre-normalisiert ohne führenden Slash für performante String-Vergleiche
  const fillerScripts = ["tasks/share.js", "tasks/xp-grind.js"];

  const maxRam = ns.getServerMaxRam(target);

  // Mindestanforderung prüfen
  if (maxRam < 64) {
    ns.print(
      `[INFO] Server-RAM (${maxRam}GB) < 64GB. fill-ram bleibt inaktiv.`,
    );
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

    // ⚡ PERFORMANCE-BOOST: ns.ps() nur EINMAL aufrufen und direkt normalisieren
    const activeProcesses = ns.ps(target).map((proc) => ({
      ...proc,
      normalizedName: proc.filename.replace(/^\//, ""),
    }));

    let allowedSharePercent = 0.0;
    let maxXpLevel = MAX_USEFUL_HACK_LEVEL;

    // Strategie auswerten
    if (state?.fillerConfig) {
      allowedSharePercent = state.fillerConfig.shareMaxRamPercent;
      maxXpLevel = state.fillerConfig.maxXpLevel || MAX_USEFUL_HACK_LEVEL;
    } else if (state) {
      if (state.strategy === "REP") allowedSharePercent = 0.6;
      else if (state.strategy === "MONEY") allowedSharePercent = 0.0; // 🎯 0% Share während des Geld-Sprints!
    }
    // Share-Cap Absicherung
    if (
      currentSharePower >= GLOBAL_SHARE_POWER_CAP &&
      state?.strategy !== "REP"
    ) {
      allowedSharePercent = 0.02;
    }

    // --- EINHEITLICHE RAM-RESERVIERUNG ---
    const isBatcherActive =
      state?.strategy === "MONEY" ||
      (state?.batcherRamNeeded && state.batcherRamNeeded > 0);
    let baseReserve = 0;
    const batcherRamReservation = state?.batcherRamNeeded
      ? state.batcherRamNeeded + 4
      : 40;

    if (target === "home") {
      // Dynamischer Puffer: Maximal 25% des RAMs auf kleinen Home-Servern, gecappt bei 32GB
      baseReserve = Math.min(32, maxRam * 0.25);
      if (isBatcherActive) {
        baseReserve += batcherRamReservation;
      }
    } else {
      if (isBatcherActive) {
        baseReserve = Math.floor(maxRam * 0.4); // 40% für Batcher reservieren
      } else {
        baseReserve = Math.min(32, maxRam * 0.1); // Kleiner Puffer für Standard-Worker
      }
    }

    // Bestimme das aktive Skript anhand der aktuellen Bedingungen
    let activeScript = "";
    if (
      p.skills.hacking < maxXpLevel &&
      state?.strategy !== "MONEY" &&
      (state?.strategy === "XP_SPRINT" || p.skills.hacking < 250)
    ) {
      activeScript = "tasks/xp-grind.js";
    } else if (allowedSharePercent > 0) {
      activeScript = "tasks/share.js";
    }

    // 🔄 REIHENFOLGE-OPTIMIERUNG: Cleanup inaktiver Filler VOR der RAM-Berechnung
    // Das gibt das RAM sofort frei und verhindert den 1.5-Sekunden-Lag beim Strategiewechsel
    for (const fScript of fillerScripts) {
      if (fScript !== activeScript) {
        const isRunning = activeProcesses.some(
          (proc) => proc.normalizedName === fScript,
        );
        if (isRunning) {
          ns.scriptKill(fScript, target);
          // Aus der lokalen Prozessliste entfernen, damit das RAM rechnerisch sofort frei ist
          const idx = activeProcesses.findIndex(
            (proc) => proc.normalizedName === fScript,
          );
          if (idx !== -1) activeProcesses.splice(idx, 1);
        }
      }
    }

    let targetThreads = 0;

    if (activeScript !== "") {
      const scriptRam = ns.getScriptRam(activeScript, target);
      const usedRam = ns.getServerUsedRam(target);

      // Ermittle die aktuell laufenden Threads des AKTIVEN Filler-Skripts
      const currentThreads = activeProcesses
        .filter((proc) => proc.normalizedName === activeScript)
        .reduce((acc, proc) => acc + proc.threads, 0);

      // Rechnerisch freies RAM bestimmen (als ob das aktive Filler-Skript nicht liefe)
      const virtualFreeRam =
        maxRam - (usedRam - currentThreads * scriptRam) - baseReserve;

      if (activeScript === "tasks/xp-grind.js") {
        targetThreads = Math.max(0, Math.floor(virtualFreeRam / scriptRam));
      } else if (activeScript === "tasks/share.js") {
        const maxAllowedShareRam = maxRam * allowedSharePercent;
        const threadCapByPercent = Math.floor(maxAllowedShareRam / scriptRam);
        const threadCapByPhysicalRam = Math.floor(virtualFreeRam / scriptRam);

        targetThreads = Math.max(
          0,
          Math.min(threadCapByPercent, threadCapByPhysicalRam),
        );
      }

      // --- EXECUTION & HYSTERESE SCALING ---
      const threadDiff = Math.abs(targetThreads - currentThreads);
      const shouldScaleDown = targetThreads < currentThreads; // Sofort runterfahren bei RAM-Mangel
      const shouldScaleUp =
        targetThreads > currentThreads &&
        (threadDiff > currentThreads * 0.1 || currentThreads === 0); // Nur hochskalieren bei >10% Änderung

      if (shouldScaleDown || shouldScaleUp) {
        if (currentThreads > 0) {
          ns.scriptKill(activeScript, target);
        }
        if (targetThreads > 0) {
          if (activeScript === "tasks/xp-grind.js") {
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
              Math.random(), // Verhindert collisions bei Multi-Server-Starts
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
