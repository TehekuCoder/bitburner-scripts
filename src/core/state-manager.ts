import { NS, FactionName, CompanyName, JobField } from "@ns";
import { Logger } from "./logger.js";

export type BotStrategy =
  | "MONEY"
  | "XP_SPRINT"
  | "REP"
  | "CORP"
  | "TRAIN"
  | "KILLS"
  | "CRIME"
  | "PSERV_RUSH";
  
export interface BotState {
  strategy: BotStrategy;
  targetFaction?: FactionName;
  targetCompany?: CompanyName;
  targetStat?: number;
  progressBar: string;
  lastUpdate: number;      
  playerHacking: number;   
  jobField?: JobField;
  targetKills?: number;
  batcherRamNeeded?: number;
  batcherTarget?: string;
  fillerConfig?: {
    shareMaxRamPercent: number;
    maxXpLevel: number;        
  };
  moneyReserve?: number;
  sleeveGlobalMode?: "RECOVERY" | "CRIME" | "COMPANY" | "FACTION";
  targetSleeveCompany?: CompanyName;
}

// Wir reservieren Port 1 fest für den globalen Systemzustand
const STATE_PORT = 1;

let _logger: Logger | null = null;
function getLogger(ns: NS): Logger {
  if (!_logger) _logger = new Logger(ns, "State", "INFO");
  return _logger;
}

/**
 * Schreibt den Zustand direkt als natives Objekt in den Port.
 * Der Port fungiert hier als "State Cell", die immer genau 1 Element enthält.
 */
export function saveState(
  ns: NS,
  state: Omit<BotState, "lastUpdate" | "playerHacking">,
): void {
  try {
    const port = ns.getPortHandle(STATE_PORT);
    const fullState: BotState = {
      ...state,
      lastUpdate: Date.now(),
      playerHacking: ns.getHackingLevel(),
    };

    port.clear(); // Alten State verwerfen
    port.write(fullState); // Neuen State als natives Objekt pushen
  } catch (error) {
    getLogger(ns).error(`Zustand konnte nicht in Port geschrieben werden: ${error}`);
  }
}

/**
 * ATOMARES UPDATE: Liest, modifiziert und schreibt den State in einem einzigen,
 * synchronen Rutsch. Da kein 'await' existiert, ist diese Operation blockierend
 * und absolut sicher vor Race Conditions.
 */
export function patchState(
  ns: NS,
  partialState: Partial<Omit<BotState, "lastUpdate" | "playerHacking">>,
): void {
  const port = ns.getPortHandle(STATE_PORT);
  
  // Nicht-destruktives Lesen des aktuellen Zustands
  const data = port.peek();
  let currentState: BotState | null = null;
  
  // Bitburner-Ports geben den String "NULL" zurück, wenn sie leer sind
  if (data !== "NULL" && data !== undefined) {
    currentState = data as BotState;
  }

  const { lastUpdate, playerHacking, ...cleanedCurrentState } = currentState || {};

  const baseState: Omit<BotState, "lastUpdate" | "playerHacking"> = {
    strategy: "MONEY",
    progressBar: "Prüfe System...",
    ...cleanedCurrentState,
  };

  // Überschreibt den Port atomar
  const fullState: BotState = {
    ...baseState,
    ...partialState,
    lastUpdate: Date.now(),
    playerHacking: ns.getHackingLevel(),
  };

  port.clear();
  port.write(fullState);
}

/**
 * Liest den aktuellen Zustand, ohne ihn aus der Port-Queue zu entfernen (peek).
 */
export function loadState(ns: NS): BotState | null {
  try {
    const port = ns.getPortHandle(STATE_PORT);
    const data = port.peek();

    if (data === "NULL PORT DATA" || data === undefined) {
      return null;
    }

    const state = data as BotState;

    // --- CONTEXT ACCURACY CHECK ---
    const resetInfo = ns.getResetInfo();
    const freshResetDetected = resetInfo.lastAugReset < 15000 && (Date.now() - state.lastUpdate) > resetInfo.lastAugReset;

    if (state.playerHacking > ns.getHackingLevel() || freshResetDetected) {
      getLogger(ns).warn("Veralteten Zustand im Port nach Reset erkannt. Bereinige Port...");
      clearState(ns);
      return null;
    }

    if (Date.now() - state.lastUpdate > 60_000) {
      getLogger(ns).info("Port-Zustand ist älter als 60s.");
    }

    return state;
  } catch (error) {
    getLogger(ns).error(`Port ${STATE_PORT} konnte nicht gelesen werden: ${error}`);
    return null;
  }
}

/**
 * Leert den zugewiesenen Port vollständig.
 */
export function clearState(ns: NS): void {
  ns.getPortHandle(STATE_PORT).clear();
  getLogger(ns).info(`Port ${STATE_PORT} erfolgreich geleert.`);
}