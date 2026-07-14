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

// Typisierung für die permanenten Source-File-Upgrades
export interface SourceFileProgress {
  [sourceFileNumber: number]: number; // Key: Source-File (z.B. 4), Value: Level (z.B. 3)
}

export interface BotState {
  strategy: BotStrategy;

  // --- Spur 1: Hauptaktivität des Spielers (Exklusiv) ---
  progressBar: string;
  targetFaction?: FactionName;
  targetCompany?: CompanyName;
  targetStat?: number;
  jobField?: JobField;
  targetKills?: number;

  // --- Spur 2: Hacking & Batching (Parallel) ---
  batcherProgress?: string;
  batcherRamNeeded?: number;
  batcherTarget?: string;
  fillerConfig?: {
    shareMaxRamPercent: number;
    maxXpLevel: number;
  };

  // --- Spur 3: Finanzen & Upgrades (Parallel) ---
  financeProgress?: string;
  moneyReserve?: number;

  // --- Spur 4: Stock Market / Trading (Parallel) ---
  traderMode?: "INACTIVE" | "EARLY" | "4S_ACTIVE" | "LIQUIDATING";
  traderProgress?: string;

  // --- Spur 5: Hacknet (Parallel) ---
  hacknetMode?: "INACTIVE" | "PRODUCTION" | "HASH_SPENDING";
  hacknetProgress?: string;

  // --- Spur 6: Sleeves (Parallel) ---
  sleeveGlobalMode?: "RECOVERY" | "CRIME" | "COMPANY" | "FACTION";
  targetSleeveCompany?: CompanyName;

  // --- Spur 7: Progression & Unlocks (0 GB RAM Info-Spur) ---
  // Hält fest, was in dieser BitNode oder permanent freigeschaltet ist
  currentBitNode: number;              // Aktueller BitNode (z.B. 10)
  currentBitNodeLevel: number;         // Aktuelles Level im aktuellen BitNode (z.B. 2)
  sourceFiles: SourceFileProgress;     // Deine freigeschalteten SFs (z.B. { 1: 3, 4: 3, 5: 3, 10: 1 })
  
  hasDarkScapeNavigator: boolean;     // Exklusiv für Bitburner 3.0 Navigator
  hasTorRouter: boolean;               // TOR-Router im aktuellen Run gekauft?
  hasGang: boolean;                    // Gang freigeschaltet und aktiv?
  hasCorporation: boolean;             // Corp aktiv?
  hasBladeburner: boolean;             // Bladeburner aktiv?

  // --- Kernel- & UI-Tracking-Felder ---
  lastUpdate: number;
  playerHacking: number;
  kernelTarget?: string;
  rootCount?: number;
  totalNodes?: number;
  isFleetMode?: boolean;
  sources?: Record<string, string>;
}

const STATE_PORT = 1;

let _logger: Logger | null = null;
function getLogger(ns: NS): Logger {
  if (!_logger) _logger = new Logger(ns, "State", "INFO");
  return _logger;
}

function getCallerName(ns: NS): string {
  const path = ns.getScriptName();
  return path.split("/").pop() || "unknown";
}

function isPortEmpty(data: any): boolean {
  return (
    data === undefined ||
    data === null ||
    data === "NULL PORT DATA" ||
    data === "NULL"
  );
}

export function saveState(
  ns: NS,
  state: Omit<BotState, "lastUpdate" | "playerHacking" | "sources">,
): void {
  try {
    const port = ns.getPortHandle(STATE_PORT);
    const caller = getCallerName(ns);

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
    getLogger(ns).error(
      `Zustand konnte nicht in Port geschrieben werden: ${error}`,
    );
  }
}

export function patchState(
  ns: NS,
  partialState: Partial<
    Omit<BotState, "lastUpdate" | "playerHacking" | "sources">
  >,
): void {
  const port = ns.getPortHandle(STATE_PORT);
  const data = port.peek();
  let currentState: BotState | null = null;

  if (!isPortEmpty(data)) {
    currentState = data as BotState;
  }

  const {
    lastUpdate,
    playerHacking,
    sources: oldSources,
    ...cleanedCurrentState
  } = currentState || {};

  // Default-Werte für Progression, damit keine "undefined"-Fehler auftreten
  const baseState: Omit<BotState, "lastUpdate" | "playerHacking" | "sources"> = {
    strategy: "MONEY",
    progressBar: "Prüfe System...",
    batcherProgress: "Inaktiv",
    financeProgress: "Berechne Budget...",
    traderProgress: "Kein Depot",
    hacknetProgress: "Inaktiv",
    
    // Standatmuster für Progression
    currentBitNode: 1,
    currentBitNodeLevel: 1,
    sourceFiles: {},
    hasDarkScapeNavigator: false,
    hasTorRouter: false,
    hasGang: false,
    hasCorporation: false,
    hasBladeburner: false,
    
    ...cleanedCurrentState,
  };

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

    if (isPortEmpty(data)) {
      return null;
    }

    return data as BotState;
  } catch (error) {
    getLogger(ns).error(
      `Port ${STATE_PORT} konnte nicht gelesen werden: ${error}`,
    );
    return null;
  }
}

export function clearState(ns: NS): void {
  ns.getPortHandle(STATE_PORT).clear();
  getLogger(ns).info(`Port ${STATE_PORT} erfolgreich geleert.`);
}