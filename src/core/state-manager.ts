import { NS, FactionName, CompanyName } from "@ns";

// Zentrale Schnittstelle für den Systemstatus
export interface BotState {
  strategy: string;
  targetFaction?: FactionName;
  targetCompany?: CompanyName;
  targetStat?: number;
  progressBar: string;
}

const STATE_FILE = "bitos_state.txt";

/**
 * Schreibt den aktuellen Zustand des Bots typsicher in die Statusdatei.
 */
export function saveState(ns: NS, state: BotState): void {
  try {
    ns.write(STATE_FILE, JSON.stringify(state, null, 2), "w");
  } catch (error) {
    ns.print(`[ERROR] State-Manager konnte Zustand nicht schreiben: ${error}`);
  }
}

/**
 * Liest den Zustand aus der Statusdatei und parst ihn als BotState.
 * Gibt null zurück, wenn die Datei nicht existiert oder beschädigt ist.
 */
export function loadState(ns: NS): BotState | null {
  if (!ns.fileExists(STATE_FILE, "home")) {
    return null;
  }
  
  try {
    const content = ns.read(STATE_FILE);
    if (!content || content.trim() === "") return null;
    return JSON.parse(content) as BotState;
  } catch (error) {
    ns.print(`[ERROR] State-Manager konnte Zustand nicht lesen/parsen: ${error}`);
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