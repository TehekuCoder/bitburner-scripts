import { NS, FactionName, CompanyName, JobField } from "@ns";

// Zentrale Schnittstelle für den Systemstatus
export interface BotState {
  strategy: string;
  targetFaction?: FactionName;
  targetCompany?: CompanyName;
  targetStat?: number;
  progressBar: string;
  lastUpdate: number; // NEU: Zeitstempel zur Desync-Erkennung
  playerHacking: number; // NEU: Verhindert das Laden von Endgame-States nach einem Augmentation-Reset
  jobField?: JobField;
}

const STATE_FILE = "bitos_state.txt";

/**
 * Schreibt den aktuellen Zustand des Bots typsicher in die Statusdatei.
 */
export function saveState(
  ns: NS,
  state: Omit<BotState, "lastUpdate" | "playerHacking">,
): void {
  try {
    const fullState: BotState = {
      ...state,
      lastUpdate: Date.now(),
      playerHacking: ns.getHackingLevel(), // Aktuelles Level mitspeichern
    };
    ns.write(STATE_FILE, JSON.stringify(fullState, null, 2), "w");
  } catch (error) {
    ns.print(`[ERROR] State-Manager konnte Zustand nicht schreiben: ${error}`);
  }
}

/**
 * Erlaubt es, nur einzelne Felder des Zustands zu aktualisieren,
 * ohne den gesamten Zustand außerhalb des Managers verwalten zu müssen.
 */
export function patchState(
  ns: NS,
  partialState: Partial<Omit<BotState, "lastUpdate" | "playerHacking">>,
): void {
  const currentState = loadState(ns);

  // Wenn kein Zustand existiert, erstellen wir einen Standard-Fallback
  const baseState = currentState || {
    strategy: "MONEY",
    progressBar: "Prüfe System...",
  };

  saveState(ns, {
    ...baseState,
    ...partialState,
  });
}

/**
 * Liest den Zustand aus der Statusdatei und parst ihn als BotState.
 * Validiert, ob der Zustand noch zum aktuellen Spiel-Kontext passt.
 */
export function loadState(ns: NS): BotState | null {
  if (!ns.fileExists(STATE_FILE, "home")) {
    return null;
  }

  try {
    const content = ns.read(STATE_FILE);
    if (!content || content.trim() === "") return null;

    const state = JSON.parse(content) as BotState;

    // --- CONTEXT ACCURACY CHECK ---
    // Wenn das gespeicherte Hacking-Level HÖHER ist als unser aktuelles Level,
    // hat in der Zwischenzeit ein Augmentation-Reset stattgefunden!
    // Der alte Zustand ist korrupt und ungültig.
    if (state.playerHacking > ns.getHackingLevel()) {
      ns.print(
        "⚠️ [State-Manager] Entdeckte veralteten Zustand (Augmentation Reset!). Lösche Datei...",
      );
      clearState(ns);
      return null;
    }

    // Wenn der Zustand älter als 60 Sekunden ist, arbeitet der Dispatcher wohl gerade nicht
    if (Date.now() - state.lastUpdate > 60_000) {
      ns.print("ℹ️ [State-Manager] Zustand ist älter als 60s (inkonsistent).");
    }

    return state;
  } catch (error) {
    ns.print(
      `[ERROR] State-Manager konnte Zustand nicht lesen/parsen: ${error}`,
    );
    return null;
  }
}

/**
 * Löscht die Statusdatei (z.B. beim System-Reset oder Herunterfahren).
 */
export function clearState(ns: NS): void {
  if (ns.fileExists(STATE_FILE, "home")) {
    ns.rm(STATE_FILE, "home");
  }
}
