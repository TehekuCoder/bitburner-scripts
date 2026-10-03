import { NS } from "@ns";
import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";
import {
  STATE_BACKUP_PORT,
  STATE_LOCK_PORT,
  STATE_PORT,
} from "../runtime/system";
import { CorporationState } from "/shared/types/corporation.js";

import {
  BotState,
  StrategyState,
  BotStateProgress,
} from "/shared/types/strategy.js";
import { BatcherState } from "/shared/types/batcher.js";
import { SleeveState } from "/shared/types/sleeves.js";
import { AugmentState, FactionState } from "/shared/types/factions.js";
import { GangState } from "/shared/types/gang.js";
import { FinanceState } from "/shared/types/finance.js";

type BotStateContent = Omit<
  BotState,
  "lastUpdate" | "playerHacking" | "sources"
>;

interface StoredBotState {
  revision: number;
  state: BotState;
}

export type BotStatePatch = Partial<BotStateContent>;
export type BatcherStatePatch = Partial<BatcherState>;
export type StrategyStatePatch = Partial<StrategyState>;
export type FinanceStatePatch = Partial<FinanceState>;
export type SleeveStatePatch = Partial<SleeveState>;
export type AugmentStatePatch = Partial<AugmentState>;
export type FactionStatePatch = Partial<FactionState>;
export type ProgressStatePatch = Partial<BotStateProgress>;
export type GangStatePatch = Partial<GangState>;
export type CorporationStatePatch = Partial<CorporationState>;

// ============================================================================
// MODULARE DOMAIN DEFAULTS
// ============================================================================

const DEFAULT_STRATEGY_STATE: StrategyState = {
  strategy: "MONEY",
  manualMode: false,
  targetFaction: undefined,
  targetCompany: undefined,
  targetStat: undefined,
  targetKills: undefined,
  isGrindingNFG: false,
  isDominionActive: false,
};

const DEFAULT_BATCHER_STATE: BatcherState = {
  batchStrategy: "BOOTSTRAP",
  batcherPhase: undefined,
  batcherTarget: "Keines",
  batcherProgress: "Inaktiv",
  batcherActive: false,
  batcherActiveBatches: 0,
  batcherTargetsSummary: [],
  batcherPlan: null,
  batcherDynamicMaxBatches: 0,
  batcherRamNeeded: 0,
};

const DEFAULT_FINANCE_STATE: FinanceState = {
  financeProgress: "Berechne Budget...",
  traderProgress: "Kein Depot",
  traderMode: undefined,
  moneyReserve: 0,
  isHomePrioritized: false,
  isRushModeActive: false,
  homeCores: 1,
};

const DEFAULT_SLEEVE_STATE: SleeveState = {
  sleeveProgress: "Inaktiv",
  sleeveGlobalMode: undefined,
  targetFaction: undefined,
  targetCompany: undefined,
  targetStat: undefined,
  strategy: undefined,
  autoBuyAugs: false,
  isDominionActive: false,
};

const DEFAULT_AUGMENT_STATE: AugmentState = {
  augRoadMap: [],
  isBN2GangMode: false,
};

const DEFAULT_FACTION_STATE: FactionState = {
  targetFaction: undefined,
  factionCurrentReps: {},
  strategy: undefined,
  isGrindingNFG: false,
};

const DEFAULT_PROGRESS_STATE: BotStateProgress = {
  progressBar: "Prüfe System...",
  financeProgress: "Berechne Budget...",
  traderProgress: "Kein Depot",
  hacknetProgress: "Inaktiv",
  sleeveProgress: "Inaktiv",
  sleeveGlobalMode: undefined,
  fillerConfig: null,
  bitnodePhaseInfo: undefined,
};

const DEFAULT_GANG_STATE: GangState = {
  hasGang: false,
  gangFaction: undefined,
  isHackingGang: false,
  gangMembersCount: 0,
  gangRespect: 0,
  gangWantedPenalty: 1,
  gangPhase: "INACTIVE",
  gangProgress: "Keine Gang",
  isBN2GangMode: false,
  minWinChance: 1,
  recentLogs: [],
};

const DEFAULT_SYSTEM_STATE = {
  kernelTarget: "n00dles",
  allServers: [],
  totalNodes: 0,
  currentBitNode: 1,
  currentBitNodeLevel: 1,
  sourceFiles: {},
  hasDarkScapeNavigator: false,
  hasTorRouter: false,
  hasCorporation: false,
  hasBladeburner: false,
};

// 1. DEFAULT STATE HINZUFÜGEN
const DEFAULT_CORPORATION_STATE: CorporationState = {
  hasCorp: false,
  corpName: undefined,
  funds: 0,
  revenue: 0,
  expenses: 0,
  divisions: [],
  stage: "INACTIVE",
  investmentOffer: 0,
  corpRecentLogs: [],
};

// ============================================================================
// MASTER DEFAULT STATE (Komposition)
// ============================================================================

const DEFAULT_BOT_STATE: BotStateContent = {
  ...DEFAULT_STRATEGY_STATE,
  ...DEFAULT_BATCHER_STATE,
  ...DEFAULT_FINANCE_STATE,
  ...DEFAULT_SLEEVE_STATE,
  ...DEFAULT_AUGMENT_STATE,
  ...DEFAULT_FACTION_STATE,
  ...DEFAULT_PROGRESS_STATE,
  ...DEFAULT_GANG_STATE,
  ...DEFAULT_SYSTEM_STATE,
  ...DEFAULT_CORPORATION_STATE,
};

// ============================================================================
// SINGLE SOURCE OF TRUTH: Schlüssel-Tupel für Sub-State-Extraktion
// ============================================================================

const BATCHER_KEYS = [
  "batchStrategy",
  "batcherPhase",
  "batcherTarget",
  "batcherProgress",
  "batcherActive",
  "batcherActiveBatches",
  "batcherTargetsSummary",
  "batcherPlan",
  "batcherDynamicMaxBatches",
  "batcherRamNeeded",
] as const satisfies readonly (keyof BatcherState)[];

const STRATEGY_KEYS = [
  "strategy",
  "targetFaction",
  "targetCompany",
  "targetStat",
  "targetKills",
  "manualMode",
  "isGrindingNFG",
  "isDominionActive",
] as const satisfies readonly (keyof StrategyState)[];

const FINANCE_KEYS = [
  "traderMode",
  "traderProgress",
  "financeProgress",
  "moneyReserve",
  "isHomePrioritized",
  "isRushModeActive",
  "homeCores",
] as const satisfies readonly (keyof FinanceState)[];

const SLEEVE_KEYS = [
  "sleeveGlobalMode",
  "targetFaction",
  "targetCompany",
  "targetStat",
  "strategy",
  "sleeveProgress",
  "isDominionActive",
] as const satisfies readonly (keyof SleeveState)[];

const AUGMENT_KEYS = [
  "augRoadMap",
  "isBN2GangMode",
] as const satisfies readonly (keyof AugmentState)[];

const FACTION_KEYS = [
  "targetFaction",
  "factionCurrentReps",
  "strategy",
  "isGrindingNFG",
] as const satisfies readonly (keyof FactionState)[];

const PROGRESS_KEYS = [
  "progressBar",
  "financeProgress",
  "traderProgress",
  "hacknetProgress",
  "sleeveProgress",
  "sleeveGlobalMode",
  "fillerConfig",
  "bitnodePhaseInfo",
] as const satisfies readonly (keyof BotStateProgress)[];

const GANG_KEYS = [
  "hasGang",
  "gangFaction",
  "isHackingGang",
  "gangMembersCount",
  "gangRespect",
  "gangWantedPenalty",
  "gangPhase",
  "gangProgress",
  "isBN2GangMode",
  "minWinChance",
  "recentLogs",
] as const satisfies readonly (keyof GangState)[];

// ============================================================================
// UTILITY FUNCTIONS & PORT OPERATIONS
// ============================================================================

let _logger: Logger | null = null;
function getLogger(ns: NS): Logger {
  if (!_logger) _logger = new Logger(ns, "State");
  return _logger;
}

function getCallerName(ns: NS): string {
  const path = ns.getScriptName();
  return path.split("/").pop() || "unknown";
}

function isPortEmpty(data: unknown): boolean {
  return (
    data === undefined ||
    data === null ||
    data === "NULL PORT DATA" ||
    data === "NULL"
  );
}

function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

export function loadState(ns: NS): BotState | null {
  try {
    const primary = readStoredState(ns, STATE_PORT);
    const backup = readStoredState(ns, STATE_BACKUP_PORT);
    if (!primary) return backup?.state ?? null;
    if (!backup) return primary.state;
    return primary.revision >= backup.revision
      ? primary.state
      : backup.state;
  } catch (error) {
    getLogger(ns).error(`Zustand konnte nicht gelesen werden: ${error}`);
    return null;
  }
}

function readStoredState(ns: NS, portNumber: number): StoredBotState | null {
  const data = ns.getPortHandle(portNumber).peek();
  if (
    isPortEmpty(data) ||
    typeof data !== "object" ||
    data === null ||
    Array.isArray(data)
  ) {
    return null;
  }

  const stored = data as Partial<StoredBotState> & Partial<BotState>;
  if (
    typeof stored.revision === "number" &&
    typeof stored.state === "object" &&
    stored.state !== null
  ) {
    return { revision: stored.revision, state: stored.state };
  }
  if (typeof stored.lastUpdate !== "number") return null;
  return { revision: 0, state: stored as BotState };
}

async function acquireStateLock(ns: NS): Promise<void> {
  const lockPort = ns.getPortHandle(STATE_LOCK_PORT);
  const owner = { pid: ns.pid, hostname: ns.getHostname() };

  while (!ns.tryWritePort(STATE_LOCK_PORT, owner)) {
    const currentOwner = lockPort.peek();
    if (
      isPortEmpty(currentOwner) ||
      typeof currentOwner !== "object" ||
      currentOwner === null ||
      typeof currentOwner.pid !== "number" ||
      typeof currentOwner.hostname !== "string" ||
      !ns.isRunning(currentOwner.pid, currentOwner.hostname)
    ) {
      lockPort.clear();
    } else {
      await ns.sleep(1);
    }
  }
}

function writeStoredState(ns: NS, state: BotState): void {
  const primary = readStoredState(ns, STATE_PORT);
  const backup = readStoredState(ns, STATE_BACKUP_PORT);
  const primaryRevision = primary?.revision ?? -1;
  const backupRevision = backup?.revision ?? -1;
  const activePort =
    primaryRevision >= backupRevision ? STATE_PORT : STATE_BACKUP_PORT;
  const inactivePort =
    activePort === STATE_PORT ? STATE_BACKUP_PORT : STATE_PORT;
  const revision = Math.max(primaryRevision, backupRevision, 0) + 1;
  const snapshot: StoredBotState = { revision, state };
  const port = ns.getPortHandle(inactivePort);

  port.clear();
  port.write(snapshot);
}

export async function saveState(
  ns: NS,
  state: BotStateContent,
): Promise<void> {
  await acquireStateLock(ns);
  try {
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

    writeStoredState(ns, fullState);
  } catch (error) {
    getLogger(ns).error(
      `Zustand konnte nicht in Port geschrieben werden: ${error}`,
    );
  } finally {
    ns.getPortHandle(STATE_LOCK_PORT).clear();
  }
}

export async function patchState(
  ns: NS,
  partialState: BotStatePatch,
): Promise<void> {
  await acquireStateLock(ns);
  try {
    const currentState: Partial<BotState> = loadState(ns) ?? {};

    const mergedState: BotStateContent = {
      ...DEFAULT_BOT_STATE,
      ...currentState,
      ...partialState,
    };

    const caller = getCallerName(ns);
    const sources: Record<string, string> = { ...(currentState.sources || {}) };
    for (const key of Object.keys(partialState)) {
      sources[key] = caller;
    }

    const fullState: BotState = {
      ...mergedState,
      sources,
      lastUpdate: Date.now(),
      playerHacking: ns.getHackingLevel(),
    };

    writeStoredState(ns, fullState);
  } catch (error) {
    getLogger(ns).error(`Zustand konnte nicht gepatcht werden: ${error}`);
  } finally {
    ns.getPortHandle(STATE_LOCK_PORT).clear();
  }
}

export async function clearState(ns: NS): Promise<void> {
  await acquireStateLock(ns);
  try {
    ns.getPortHandle(STATE_PORT).clear();
    ns.getPortHandle(STATE_BACKUP_PORT).clear();
    getLogger(ns).info("State-Ports erfolgreich geleert.");
  } finally {
    ns.getPortHandle(STATE_LOCK_PORT).clear();
  }
}

// ============================================================================
// GENERISCHE SUB-STATE LOADER & PATCHER WRAPPER
// ============================================================================

export function loadBatcherState(ns: NS): BatcherState | null {
  const state = loadState(ns);
  return state ? pick(state, BATCHER_KEYS) : null;
}
export async function patchBatcherState(
  ns: NS,
  partialState: BatcherStatePatch,
): Promise<void> {
  await patchState(ns, partialState as BotStatePatch);
}

export function loadStrategyState(ns: NS): StrategyState | null {
  const state = loadState(ns);
  return state ? pick(state, STRATEGY_KEYS) : null;
}
export async function patchStrategyState(
  ns: NS,
  partialState: StrategyStatePatch,
): Promise<void> {
  await patchState(ns, partialState as BotStatePatch);
}

export function loadFinanceState(ns: NS): FinanceState | null {
  const state = loadState(ns);
  return state ? pick(state, FINANCE_KEYS) : null;
}
export async function patchFinanceState(
  ns: NS,
  partialState: FinanceStatePatch,
): Promise<void> {
  await patchState(ns, partialState as BotStatePatch);
}

export function loadSleeveState(ns: NS): SleeveState | null {
  const state = loadState(ns);
  return state ? pick(state, SLEEVE_KEYS) : null;
}
export async function patchSleeveState(
  ns: NS,
  partialState: SleeveStatePatch,
): Promise<void> {
  await patchState(ns, partialState as BotStatePatch);
}

export function loadAugmentState(ns: NS): AugmentState | null {
  const state = loadState(ns);
  return state ? pick(state, AUGMENT_KEYS) : null;
}
export async function patchAugmentState(
  ns: NS,
  partialState: AugmentStatePatch,
): Promise<void> {
  await patchState(ns, partialState as BotStatePatch);
}

export function loadFactionState(ns: NS): FactionState | null {
  const state = loadState(ns);
  return state ? pick(state, FACTION_KEYS) : null;
}
export async function patchFactionState(
  ns: NS,
  partialState: FactionStatePatch,
): Promise<void> {
  await patchState(ns, partialState as BotStatePatch);
}

export function loadProgressState(ns: NS): BotStateProgress | null {
  const state = loadState(ns);
  return state ? pick(state, PROGRESS_KEYS) : null;
}
export async function patchProgressState(
  ns: NS,
  partialState: ProgressStatePatch,
): Promise<void> {
  await patchState(ns, partialState as BotStatePatch);
}

export function loadGangState(ns: NS): GangState | null {
  const state = loadState(ns);
  return state ? pick(state, GANG_KEYS) : null;
}
export async function patchGangState(
  ns: NS,
  partialState: GangStatePatch,
): Promise<void> {
  await patchState(ns, partialState as BotStatePatch);
}

// 2. KEYS DEFINIEREN
const CORPORATION_KEYS = [
  "hasCorp",
  "corpName",
  "funds",
  "revenue",
  "expenses",
  "divisions",
  "stage",
  "investmentOffer",
  "corpRecentLogs",
] as const satisfies readonly (keyof BotState)[];

export function loadCorporationState(ns: NS): CorporationState | null {
  const state = loadState(ns);
  return state ? (pick(state, CORPORATION_KEYS) as CorporationState) : null;
}

export async function patchCorporationState(
  ns: NS,
  partialState: CorporationStatePatch,
): Promise<void> {
  await patchState(ns, partialState as BotStatePatch);
}
