import { NS, FactionName, CompanyName, JobField } from "@ns";
import { Logger } from "./logger.js"; // 🌟 Zentrales Logging-System integriert

// Strikte Definition aller erlaubten System-Strategien – PURE_HACK entfernt!
export type BotStrategy =
  | "MONEY"
  | "XP_SPRINT"
  | "REP"
  | "CORP"
  | "TRAIN"
  | "KILLS"
  | "CRIME";

export interface BotState {
  strategy: BotStrategy;
  targetFaction?: FactionName;
  targetCompany?: CompanyName;
  targetStat?: number;
  progressBar: string;
  lastUpdate: number;      // Zeitstempel zur Desync-Erkennung
  playerHacking: number;   // Verhindert das Laden von Endgame-States nach einem Reset
  jobField?: JobField;
  targetKills?: number;
  
  // RAM-Bedarf des aktuellen Batcher-Ziels (Verhindert Deadlocks mit fill-ram)
  batcherRamNeeded?: number;
  batcherTarget?: string;

  // Zentrale Ressourcen-Kontrolle für fill-ram
  fillerConfig?: {
    shareMaxRamPercent: number; // Wie viel % des Home-RAMs darf Share fressen (0.0 - 1.0)
    maxXpLevel: number;          // Bis zu welchem Hacking-Level macht XP-Grind Sinn
  };

  moneyReserve?: number; // Betrag, der für wichtige Core-Upgrades unangetastet bleiben MUSS

  sleeveGlobalMode?: "RECOVERY" | "CRIME" | "COMPANY" | "FACTION";
  targetSleeveCompany?: CompanyName;
}

const STATE_FILE = "bitos_state.txt";

/**
 * Schreibt den aktuellen Zustand des Bots typsicher in die Statusdatei.
 */
export function saveState(
  ns: NS,
  state: Omit<BotState, "lastUpdate" | "playerHacking">,
): void {
  const logger = new Logger(ns, "State", "INFO");
  try {
    const fullState: BotState = {
      ...state,
      lastUpdate: Date.now(),
      playerHacking: ns.getHackingLevel(),
    };
    ns.write(STATE_FILE, JSON.stringify(fullState, null, 2), "w");
  } catch (error) {
    logger.error(`Zustand konnte nicht geschrieben werden: ${error}`);
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
  const logger = new Logger(ns, "State", "INFO");

  if (!ns.fileExists(STATE_FILE, "home")) {
    return null;
  }

  try {
    const content = ns.read(STATE_FILE);
    if (!content || content.trim() === "") return null;

    const state = JSON.parse(content) as BotState;

    // --- CONTEXT ACCURACY CHECK ---
    // Falls das Hacking-Level im State höher ist als das aktuelle des Spielers -> Augmentation Reset erfolgt!
    if (state.playerHacking > ns.getHackingLevel()) {
      logger.warn("Veralteten Zustand nach Augmentation-Reset erkannt. Bereinige Persistenz-Speicher...");
      clearState(ns);
      return null;
    }

    // Sanfter Hinweis bei potenziellen asynchronen Hängern (Inkonsistenz-Warnung)
    if (Date.now() - state.lastUpdate > 60_000) {
      logger.info("Zustand ist älter als 60s (potenziell inkonsistent).");
    }

    return state;
  } catch (error) {
    logger.error(`Zustand konnte nicht gelesen oder geparst werden: ${error}`);
    return null;
  }
}

/**
 * Löscht die Statusdatei (z.B. beim System-Reset oder Herunterfahren).
 */
export function clearState(ns: NS): void {
  const logger = new Logger(ns, "State", "INFO");
  if (ns.fileExists(STATE_FILE, "home")) {
    ns.rm(STATE_FILE, "home");
    logger.info("Statusdatei erfolgreich gelöscht.");
  }
}