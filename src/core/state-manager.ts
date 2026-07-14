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

  // --- Neue Kernel- & UI-Tracking-Felder ---
  kernelTarget?: string;
  rootCount?: number;
  totalNodes?: number;
  isFleetMode?: boolean;
  sources?: Record<string, string>; // Speichert: { state_key: "script-name.js" }
}

const STATE_PORT = 1;

let _logger: Logger | null = null;
function getLogger(ns: NS): Logger {
  if (!_logger) _logger = new Logger(ns, "State", "INFO");
  return _logger;
}

/**
 * Hilfsfunktion zur automatischen Erkennung des aufrufenden Skripts
 */
function getCallerName(ns: NS): string {
  const path = ns.getScriptName();
  return path.split("/").pop() || "unknown";
}

/**
 * 🛠️ FIX: Einheitliche und absolut sichere Port-Leer-Prüfung
 * Fängt alle Bitburner-spezifischen Rückgabewerte für leere Ports ab.
 */
function isPortEmpty(data: any): boolean {
  return data === undefined || data === null || data === "NULL PORT DATA" || data === "NULL";
}

export function saveState(
  ns: NS,
  state: Omit<BotState, "lastUpdate" | "playerHacking" | "sources">,
): void {
  try {
    const port = ns.getPortHandle(STATE_PORT);
    const caller = getCallerName(ns);

    // Initialisiere die Sources für alle übergebenen Keys
    const sources: Record<string, string> = {};
    for (const key of Object.keys(state)) {
      sources[key] = caller;
    }

    const fullState: BotState = {
      ...state,
      sources,
      lastUpdate: Date.now(),
      playerHacking: ns.getHackingLevel(),
    };

    port.clear(); 
    port.write(fullState); 
  } catch (error) {
    getLogger(ns).error(`Zustand konnte nicht in Port geschrieben werden: ${error}`);
  }
}

export function patchState(
  ns: NS,
  partialState: Partial<Omit<BotState, "lastUpdate" | "playerHacking" | "sources">>,
): void {
  const port = ns.getPortHandle(STATE_PORT);
  const data = port.peek();
  let currentState: BotState | null = null;
  
  // 🛠️ FIX: Nutzt jetzt den sicheren Check, um String-Zerstörung zu verhindern
  if (!isPortEmpty(data)) {
    currentState = data as BotState;
  }

  const { lastUpdate, playerHacking, sources: oldSources, ...cleanedCurrentState } = currentState || {};

  const baseState: Omit<BotState, "lastUpdate" | "playerHacking" | "sources"> = {
    strategy: "MONEY",
    progressBar: "Prüfe System...",
    ...cleanedCurrentState,
  };

  // Herkunfts-Verfolgung anwenden
  const caller = getCallerName(ns);
  const newSources = { ...(oldSources || {}) };
  for (const key of Object.keys(partialState)) {
    newSources[key] = caller;
  }

  const fullState: BotState = {
    ...baseState,
    ...partialState,
    sources: newSources,
    lastUpdate: Date.now(),
    playerHacking: ns.getHackingLevel(),
  };

  port.clear();
  port.write(fullState);
}

export function loadState(ns: NS): BotState | null {
  try {
    const port = ns.getPortHandle(STATE_PORT);
    const data = port.peek();

    // 🛠️ FIX: Nutzt ebenfalls den einheitlichen Check
    if (isPortEmpty(data)) {
      return null;
    }

    const state = data as BotState;
    const resetInfo = ns.getResetInfo();
    
    // 🛠️ Robustheitsschutz gegen unvollständige Alt-Zustände (verhindert NaN)
    const lastUpdate = typeof state?.lastUpdate === "number" ? state.lastUpdate : 0;
    const freshResetDetected = resetInfo.lastAugReset < 15000 && (Date.now() - lastUpdate) > resetInfo.lastAugReset;

    if ((typeof state?.playerHacking === "number" && state.playerHacking > ns.getHackingLevel()) || freshResetDetected) {
      getLogger(ns).warn("Veralteten Zustand im Port nach Reset erkannt. Bereinige Port...");
      clearState(ns);
      return null;
    }

    return state;
  } catch (error) {
    getLogger(ns).error(`Port ${STATE_PORT} konnte nicht gelesen werden: ${error}`);
    return null;
  }
}

export function clearState(ns: NS): void {
  ns.getPortHandle(STATE_PORT).clear();
  getLogger(ns).info(`Port ${STATE_PORT} erfolgreich geleert.`);
}