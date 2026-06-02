import { NS, FactionWorkType, FactionName } from "@ns";

interface BotState {
  strategy: string;
  targetFaction?: FactionName;
  factionWorkType?: string;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🧬 Faction-Grind-Worker gestartet...");

  const sing = ns.singularity;

  // NEU: Die Prioritätenliste der Arbeitstypen
  const preferredWorkTypes: FactionWorkType[] = [
    "hacking" as FactionWorkType,
    "field" as FactionWorkType,
    "security" as FactionWorkType
  ];

  while (true) {
    // --- 1. STATE & TERMINATION PRÜFEN ---
    let mode = "REP";
    let targetFaction: FactionName | null = null;

    if (ns.fileExists("bitos_state.txt", "home")) {
      try {
        const content = ns.read("bitos_state.txt");
        if (content) {
          const state = JSON.parse(content) as BotState;
          mode = state.strategy;
          if (state.targetFaction) targetFaction = state.targetFaction;
        }
      } catch {
        /* Schutz vor Kollisionen */
      }
    }

    // Wenn der Dispatcher nicht mehr im REP-Modus ist: Aufräumen und Beenden
    if (mode !== "REP") {
      ns.print(`[EXIT] Modus ist nun ${mode}. Beende Grind-Worker und räume RAM auf.`);
      if (ns.scriptRunning("fill-ram.js", "home")) {
        ns.scriptKill("fill-ram.js", "home");
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
    if (mode === "REP" && targetFaction) {
      const currentWork = sing.getCurrentWork();
      const isAlreadyWorking =
        currentWork?.type === "FACTION" &&
        currentWork.factionName === targetFaction;

      if (!isAlreadyWorking) {
        let success = false;

        // Wir probieren dynamisch durch, welche Arbeit diese Fraktion anbietet
        for (const workType of preferredWorkTypes) {
          success = sing.workForFaction(targetFaction, workType, false);
          if (success) {
            ns.print(`[FACTION] Erreicht! Starte Arbeit für ${targetFaction} mit Typ: ${workType}`);
            break; // Gültige Arbeit gefunden, Schleife abbrechen
          }
        }

        if (!success) {
          ns.print(`[WARN] Konnte keine Arbeit für ${targetFaction} starten. Fehlende Stats?`);
        }
      }
    }

    // --- 4. RAM-FLUTUNG & PRIORISIERUNG ---
    const homeMaxRam = ns.getServerMaxRam("home");

    if (homeMaxRam >= 64) {
      if (ns.scriptRunning("work.ts", "home")) {
        ns.print("[TRAFFIC CONTROL] Beende work.ts auf 'home', um Platz für Reputations-Boost zu machen.");
        ns.scriptKill("work.ts", "home");
      }

      if (ns.fileExists("fill-ram.js", "home") && !ns.isRunning("fill-ram.js", "home")) {
        ns.print("[INFRA] Genug RAM vorhanden. Aktiviere fill-ram für Reputations-Bonus.");
        ns.exec("fill-ram.js", "home");
      }
    } else {
      ns.print("[WARNING] Home-RAM zu gering (< 64GB). fill-ram bleibt deaktiviert.");
    }

    await ns.sleep(5000);
  }
}