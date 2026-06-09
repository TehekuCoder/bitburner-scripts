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

  const preferredWorkTypes: FactionWorkType[] = [
    "hacking" as FactionWorkType,
    "field" as FactionWorkType,
    "security" as FactionWorkType,
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
        /* Schutz vor File-Kollisionen */
      }
    }

    if (mode !== "REP") {
      ns.print(
        `[EXIT] Modus ist nun ${mode}. Beende Grind-Worker und räume RAM auf.`,
      );
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

        for (const workType of preferredWorkTypes) {
          success = sing.workForFaction(targetFaction, workType, false);
          if (success) {
            ns.print(
              `[FACTION] Erreicht! Starte Arbeit für ${targetFaction} mit Typ: ${workType}`,
            );
            break;
          }
        }

        if (!success) {
          ns.print(
            `[WARN] Konnte keine Arbeit für ${targetFaction} starten. Fehlende Stats?`,
          );
        }
      }
    }

    // --- 4. SONDERREGELUNG: RAM-FLUTUNG & PRIORISIERUNG (Workload Manager) ---
    const homeMaxRam = ns.getServerMaxRam("home");

    // Prüfen, ob der Batcher (unter verschiedenen möglichen Pfaden/Endungen) läuft
    const isBatcherRunning =
      ns.isRunning("sys-batcher.ts", "home") ||
      ns.isRunning("sys-batcher.js", "home") ||
      ns.isRunning("core/sys-batcher.js", "home");

    // SONDERREGELUNG: Dynamische RAM-Hürde festlegen
    // Wenn der Batcher läuft, erhöhen wir das Limit massiv auf 256GB.
    const ramThreshold = isBatcherRunning ? 256 : 64;

    if (homeMaxRam >= ramThreshold) {
      // Altes Basis-Arbeitsskript beenden, falls vorhanden
      if (ns.scriptRunning("work.ts", "home")) {
        ns.print(
          "[TRAFFIC CONTROL] Beende work.ts auf 'home', um Platz für Reputations-Boost zu machen.",
        );
        ns.scriptKill("work.ts", "home");
      }

      // fill-ram starten, wenn es noch nicht läuft
      if (
        ns.fileExists("fill-ram.js", "home") &&
        !ns.isRunning("fill-ram.js", "home")
      ) {
        ns.print(
          `[INFRA] Genug RAM vorhanden (${ns.format.ram(homeMaxRam)}). Aktiviere fill-ram (Batcher aktiv: ${isBatcherRunning}).`,
        );
        ns.exec("fill-ram.js", "home");
      }
    } else {
      // AKTIVE INTERVENTION: Wenn fill-ram läuft, der RAM aber unter der benötigten Hürde liegt
      // (z.B. weil der Batcher gestartet wurde, wir aber nur 128GB RAM haben), wird es gekillt!
      if (ns.isRunning("fill-ram.js", "home")) {
        ns.print(
          `[TRAFFIC CONTROL] Konflikt erkannt! Batcher benötigt RAM. Beende fill-ram.js vorübergehend.`,
        );
        ns.scriptKill("fill-ram.js", "home");
      } else {
        ns.print(
          `[INFO] fill-ram bleibt inaktiv. RAM (${ns.format.ram(homeMaxRam)}) unter Hürde (${ns.format.ram(ramThreshold)}).`,
        );
      }
    }

    await ns.sleep(5000);
  }
}
