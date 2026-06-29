import { NS } from "@ns";
import { loadState } from "../core/state-manager.js";

export async function main(ns: NS): Promise<void> {
  const target = "home";
  ns.disableLog("ALL");

  const fillerScripts = ["/tasks/share.js", "/tasks/xp-grind.js"];

  // EARLY-GAME SCHUTZRIEGEL
  if (ns.getServerMaxRam(target) < 128) {
    ns.print(`[INFO] Home-RAM < 128GB. fill-ram bleibt inaktiv.`);
    for (const script of fillerScripts) {
      ns.scriptKill(script, target);
    }
    return;
  }

  while (true) {
    const state = loadState(ns);
    const p = ns.getPlayer();
    const maxRam = ns.getServerMaxRam(target);

    // --- 1. DYNAMISCHE QUOTEN-BERECHNUNG (ZENTRALE STEUERUNG) ---
    // Standard-Werte, falls das State-Objekt noch keine spezifische Konfiguration hat
    // --- 1. DYNAMISCHE QUOTEN-BERECHNUNG (ZENTRALE STEUERUNG) ---
    let allowedSharePercent = 0.0;
    let maxXpLevel = 1000;

    if (state?.fillerConfig) {
      // 🎯 Höchste Priorität: Die Werte der Zentrale
      allowedSharePercent = state.fillerConfig.shareMaxRamPercent;
      maxXpLevel = state.fillerConfig.maxXpLevel;
    } else if (state) {
      // 🛡️ Fallback: Nur wenn keine fillerConfig existiert
      if (state.strategy === "REP") allowedSharePercent = 0.4;
      else if (state.strategy === "MONEY") allowedSharePercent = 0.1;
    }
    // --- 2. ENTSCHEIDUNG: WELCHES SKRIPT DARF WIE VIEL? ---
    let activeScript = "";
    let targetThreads = 0;

    // A: XP-Grind Logik mit Hard-Cap über das Spieler-Level
    if (
      p.skills.hacking < maxXpLevel &&
      (state?.strategy === "XP_SPRINT" || p.skills.hacking < 250)
    ) {
      activeScript = "/tasks/xp-grind.js";

      const usedRam = ns.getServerUsedRam(target);
      const scriptRam = ns.getScriptRam(activeScript, target);
      const currentThreads = ns
        .ps(target)
        .filter((proc) => proc.filename === activeScript)
        .reduce((acc, proc) => acc + proc.threads, 0);

      // XP-Grind darf den Server füllen, lässt aber 64GB Sicherheits-Puffer für den Batcher
      const reserve = 64;
      const availableRam =
        maxRam - (usedRam - currentThreads * scriptRam) - reserve;
      targetThreads = Math.floor(availableRam / scriptRam);
    }
    // B: Share-Logik mit prozentualem RAM-Cap zur Vermeidung des Soft-Caps
    else if (allowedSharePercent > 0) {
      activeScript = "/tasks/share.js";
      const scriptRam = ns.getScriptRam(activeScript, target);

      // Maximale RAM-Allokation basierend auf der zentralen Prozent-Vorgabe
      const maxAllowedShareRam = maxRam * allowedSharePercent;
      targetThreads = Math.floor(maxAllowedShareRam / scriptRam);

      // Dynamischer Abgleich mit dem tatsächlich aktuell freien RAM (wir können nicht mehr verbrauchen als da ist)
      const usedRam = ns.getServerUsedRam(target);
      const currentThreads = ns
        .ps(target)
        .filter((proc) => proc.filename === activeScript)
        .reduce((acc, proc) => acc + proc.threads, 0);
      const physicalAvailableRam =
        maxRam - (usedRam - currentThreads * scriptRam) - 32; // 32GB Grundreserve
      const physicalMaxThreads = Math.floor(physicalAvailableRam / scriptRam);

      targetThreads = Math.min(targetThreads, physicalMaxThreads);
    }

    if (targetThreads < 0) targetThreads = 0;

    // --- 3. ANTI-LEAK-CLEANUP & SMOOTH TRANSITION ---
    // Kill alle Filler-Skripte, die gerade NICHT aktiv sein sollen
    for (const fScript of fillerScripts) {
      if (fScript !== activeScript && ns.isRunning(fScript, target)) {
        ns.print(
          `[CLEANUP] Strategiewechsel oder Cap erreicht. Beende: ${fScript}`,
        );
        ns.scriptKill(fScript, target);
      }
    }

    // --- 4. EXECUTION / SCALING ---
    if (activeScript !== "") {
      const currentThreads = ns
        .ps(target)
        .filter((proc) => proc.filename === activeScript)
        .reduce((acc, proc) => acc + proc.threads, 0);

      const threadDiff = Math.abs(targetThreads - currentThreads);
      const shouldScaleDown = targetThreads < currentThreads;
      const shouldScaleUp =
        targetThreads > currentThreads &&
        (threadDiff > currentThreads * 0.1 || currentThreads === 0);

      if (shouldScaleDown || shouldScaleUp) {
        if (currentThreads > 0) {
          ns.scriptKill(activeScript, target);
        }

        if (targetThreads > 0) {
          ns.print(
            `[RESOURCE] Zentral gesteuerte Zuweisung: ${targetThreads} Threads von ${activeScript}`,
          );

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

    await ns.sleep(10000);
  }
}
