import { NS, FactionWorkType, FactionName } from "@ns";
import { loadState, saveState } from "core/state-manager.js"; // Konsistenten State-Manager nutzen

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🧬 Faction-Grind-Worker gestartet...");

  const sing = ns.singularity;

  const preferredWorkTypes: FactionWorkType[] = [
    "hacking" as FactionWorkType,
    "field" as FactionWorkType,
    "security" as FactionWorkType,
  ];

  while (true) {
    // --- 1. STATE & STRATEGIE VIA MANAGER LADEN ---
    const state = loadState(ns);
    const mode = state?.strategy || "IDLE";
    let targetFaction = state?.targetFaction as FactionName || undefined;

    // Wenn die Strategie nicht mehr auf REP steht, beenden wir uns sauber
    if (mode !== "REP") {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Grind-Worker und räume RAM auf.`);
      if (ns.isRunning("fill-ram.js", "home")) {
        ns.kill("fill-ram.js", "home"); // BEHOBEN: ns.kill statt ns.scriptKill
        ns.print("[CLEANUP] fill-ram.js erfolgreich beendet.");
      }
      return;
    }

    // --- 2. EINLADUNGEN AUTOMATISCH ANNEHMEN ---
    const invites = sing.checkFactionInvitations();
    for (const faction of invites) {
      ns.print(`[FACTION] Neue Einladung von ${faction} erhalten. Trete bei!`);
      sing.joinFaction(faction);
    }

    // --- 3. FÜR FRAKTION ARBEITEN (DYNAMISCH) ---
    if (targetFaction) {
      const currentWork = sing.getCurrentWork();
      const isAlreadyWorking = currentWork?.type === "FACTION" && currentWork.factionName === targetFaction;

      if (!isAlreadyWorking) {
        let success = false;

        for (const workType of preferredWorkTypes) {
          success = sing.workForFaction(targetFaction, workType, false); // false = kein Fokus-Zwang
          if (success) {
            ns.print(`[FACTION] Erreicht! Starte Arbeit für ${targetFaction} mit Typ: ${workType}`);
            break;
          }
        }

        if (!success) {
          ns.print(`[WARN] Konnte keine Arbeit für ${targetFaction} starten. Fehlende Stats?`);
        }
      }
    }

    // --- 4. SONDERREGELUNG: RAM-FLUTUNG & PRIORISIERUNG (Workload Manager) ---
    const homeMaxRam = ns.getServerMaxRam("home");

    // BEHOBEN: Einheitliche Nutzung von ns.isRunning
    const isBatcherRunning =
      ns.isRunning("sys-batcher.ts", "home") ||
      ns.isRunning("sys-batcher.js", "home") ||
      ns.isRunning("core/sys-batcher.js", "home");

    const ramThreshold = isBatcherRunning ? 256 : 64;

    if (homeMaxRam >= ramThreshold) {
      // BEHOBEN: ns.isRunning und ns.kill für work.ts
      if (ns.isRunning("work.ts", "home")) {
        ns.print("[TRAFFIC CONTROL] Beende work.ts auf 'home', um Platz für Reputations-Boost zu machen.");
        ns.kill("work.ts", "home");
      }

      // fill-ram starten, wenn es noch nicht läuft
      if (ns.fileExists("fill-ram.js", "home") && !ns.isRunning("fill-ram.js", "home")) {
        // OPTIMIERT: Wir berechnen die exakt maximal verfügbaren Threads für die Flutung!
        const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
        const scriptRam = ns.getScriptRam("fill-ram.js", "home");
        const maxThreads = Math.floor(freeRam / scriptRam);

        if (maxThreads > 0) {
          ns.print(`[INFRA] Genug RAM vorhanden (${ns.format.ram(homeMaxRam)}). Aktiviere fill-ram mit ${maxThreads} Threads.`);
          ns.exec("fill-ram.js", "home", maxThreads); // BEHOBEN: Thread-Anzahl übergeben!
        }
      }
    } else {
      if (ns.isRunning("fill-ram.js", "home")) {
        ns.print(`[TRAFFIC CONTROL] Konflikt erkannt! Batcher benötigt RAM. Beende fill-ram.js.`);
        ns.kill("fill-ram.js", "home");
      }
    }

    // --- 5. HUD INTEGRATION (REPUTATION FEEDBACK) ---
    if (state && targetFaction) {
      const currentRep = sing.getFactionRep(targetFaction);
      state.progressBar = `🧬 ${targetFaction}: ${ns.format.number(currentRep, 1)} Rep`;
      saveState(ns, state);
    }

    await ns.sleep(5000);
  }
}