import { NS, FactionName, CompanyName, JobField } from "@ns";

// Strikte Definition aller erlaubten System-Strategien zur Vermeidung von Tippfehlern
export type BotStrategy =
  | "MONEY"
  | "XP_SPRINT"
  | "REP"
  | "CORP"
  | "TRAIN"
  | "PURE_HACK";

export interface BotState {
  strategy: BotStrategy;
  targetFaction?: FactionName;
  targetCompany?: CompanyName;
  targetStat?: number;
  progressBar: string;
  lastUpdate: number; // Zeitstempel zur Desync-Erkennung
  playerHacking: number; // Verhindert das Laden von Endgame-States nach einem Reset
  jobField?: JobField;
  targetKills?: number;
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
      playerHacking: ns.getHackingLevel(),
    };
    ns.write(STATE_FILE, JSON.stringify(fullState, null, 2), "w");
  } catch (error) {
    ns.print(`[ERROR] State-Manager konnte Zustand nicht schreiben: ${error}`);
  }
}

/**
 * Erlaubt es, nur einzelne Felder des Zustands zu aktualisieren.
 */
export function patchState(
  ns: NS,
  partialState: Partial<Omit<BotState, "lastUpdate" | "playerHacking">>,
): void {
  const currentState = loadState(ns);

  // Standard-Fallback, falls kein State existiert oder gelöscht wurde
  const baseState: Omit<BotState, "lastUpdate" | "playerHacking"> =
    currentState || {
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
    // hat ein Augmentation-Reset stattgefunden.
    if (state.playerHacking > ns.getHackingLevel()) {
      ns.print(
        "⚠️ [State-Manager] Veralteten Zustand nach Augmentation Reset erkannt. Bereinige...",
      );
      clearState(ns);
      return null;
    }

    // Warnung im Log, falls der Dispatcher abgestürzt ist oder blockiert
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
