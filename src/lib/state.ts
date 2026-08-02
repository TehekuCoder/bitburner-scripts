import { NS } from "@ns";
import { STATE_PORT } from "/lib/constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";

// Re-Export für Rückwärtskompatibilität (Logik liegt in lib/utils.ts)


// Direkte Typ-Imports aus den jeweiligen Dateien (mit .js Endung für Bitburner)
import { 
  BotState, 
  StrategyState, 
  BotStateProgress 
} from "/lib/types/strategy.js";
import { BatcherState } from "/lib/types/batcher.js";
import { FinanceState } from "/lib/types/common.js";
import { SleeveState } from "/lib/types/sleeves.js";
import { AugmentState, FactionState } from "/lib/types/factions.js";
import { GangState } from "/lib/types/gang.js";

type BotStateContent = Omit<
  BotState,
  "lastUpdate" | "playerHacking" | "sources"
>;

export type BotStatePatch = Partial<BotStateContent>;
export type BatcherStatePatch = Partial<BatcherState>;
export type StrategyStatePatch = Partial<StrategyState>;
export type FinanceStatePatch = Partial<FinanceState>;
export type SleeveStatePatch = Partial<SleeveState>;
export type AugmentStatePatch = Partial<AugmentState>;
export type FactionStatePatch = Partial<FactionState>;
export type ProgressStatePatch = Partial<BotStateProgress>;
export type GangStatePatch = Partial<GangState>;

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

/**
 * Überschreibt den gesamten BotState atomar.
 */
export function saveState(ns: NS, state: BotStateContent): void {
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
      `Zustand konnte nicht in Port geschrieben werden: ${error}`
    );
  }
}

/**
 * Patcht einzelne Felder im BotState atomar (schützt vor Lost Updates).
 */
export function patchState(ns: NS, partialState: BotStatePatch): void {
  const port = ns.getPortHandle(STATE_PORT);

  const data = port.read();
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

  // Vollständiger Default-State
  const baseState: BotStateContent = {
    strategy: "MONEY",
    targetFaction: undefined,
    isGrindingNFG: false,
    targetCompany: undefined,
    targetStat: undefined,
    targetKills: undefined,

    batchStrategy: "BOOTSTRAP",
    kernelTarget: "n00dles",
    batcherTarget: "Keines",
    progressBar: "Prüfe System...",
    batcherProgress: "Inaktiv",
    batcherActive: false,
    batcherActiveBatches: 0,
    batcherTargetsSummary: [],
    allServers: [],
    totalNodes: 0,
    batcherPlan: null,
    batcherDynamicMaxBatches: 0,
    batcherRamNeeded: 0,

    financeProgress: "Berechne Budget...",
    traderProgress: "Kein Depot",
    traderMode: undefined,
    moneyReserve: 0,
    isHomePrioritized: false,
    isRushModeActive: false,

    hacknetProgress: "Inaktiv",

    sleeveProgress: "Inaktiv",
    sleeveGlobalMode: undefined,

    currentBitNode: 1,
    currentBitNodeLevel: 1,
    sourceFiles: {},
    hasDarkScapeNavigator: false,
    hasTorRouter: false,

    augRoadMap: [],
    isBN2GangMode: false,

    factionCurrentReps: {},

    hasGang: false,
    gangFaction: undefined,
    isHackingGang: false,
    gangMembersCount: 0,
    gangRespect: 0,
    gangWantedPenalty: 1,
    gangPhase: "INACTIVE",
    gangProgress: "Keine Gang",

    hasCorporation: false,
    hasBladeburner: false,
    fillerConfig: null,

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

// --- Specific Loader & Patcher Wrappers ---

export function patchBatcherState(ns: NS, partialState: BatcherStatePatch): void {
  patchState(ns, partialState as BotStatePatch);
}

export function loadBatcherState(ns: NS): BatcherState | null {
  const state = loadState(ns);
  if (!state) return null;
  const {
    batcherTarget, batcherProgress, batcherActive, batcherActiveBatches,
    batcherTargetsSummary, batcherPlan, batcherDynamicMaxBatches, batcherRamNeeded,
  } = state;
  return {
    batcherTarget, batcherProgress, batcherActive, batcherActiveBatches,
    batcherTargetsSummary, batcherPlan, batcherDynamicMaxBatches, batcherRamNeeded,
  };
}

export function loadStrategyState(ns: NS): StrategyState | null {
  const state = loadState(ns);
  if (!state) return null;
  const { strategy, targetFaction, targetCompany, targetStat, targetKills } = state;
  return { strategy, targetFaction, targetCompany, targetStat, targetKills };
}

export function patchStrategyState(ns: NS, partialState: StrategyStatePatch): void {
  patchState(ns, partialState as BotStatePatch);
}

export function loadFinanceState(ns: NS): FinanceState | null {
  const state = loadState(ns);
  if (!state) return null;
  const {
    traderMode, traderProgress, financeProgress, moneyReserve, isHomePrioritized, isRushModeActive,
  } = state;
  return {
    traderMode, traderProgress, financeProgress, moneyReserve, isHomePrioritized, isRushModeActive,
  };
}

export function patchFinanceState(ns: NS, partialState: FinanceStatePatch): void {
  patchState(ns, partialState as BotStatePatch);
}

export function loadSleeveState(ns: NS): SleeveState | null {
  const state = loadState(ns);
  if (!state) return null;
  const { sleeveGlobalMode, targetFaction, targetStat, strategy, sleeveProgress } = state;
  return { sleeveGlobalMode, targetFaction, targetStat, strategy, sleeveProgress };
}

export function patchSleeveState(ns: NS, partialState: SleeveStatePatch): void {
  patchState(ns, partialState as BotStatePatch);
}

export function loadAugmentState(ns: NS): AugmentState | null {
  const state = loadState(ns);
  if (!state) return null;
  const { augRoadMap, isBN2GangMode } = state;
  return { augRoadMap, isBN2GangMode };
}

export function patchAugmentState(ns: NS, partialState: AugmentStatePatch): void {
  patchState(ns, partialState as BotStatePatch);
}

export function loadFactionState(ns: NS): FactionState | null {
  const state = loadState(ns);
  if (!state) return null;
  const { targetFaction, factionCurrentReps, strategy, isGrindingNFG } = state; // <-- isGrindingNFG hinzugefügt
  return { targetFaction, factionCurrentReps, strategy, isGrindingNFG };
}

export function patchFactionState(ns: NS, partialState: FactionStatePatch): void {
  patchState(ns, partialState as BotStatePatch);
}

export function loadProgressState(ns: NS): BotStateProgress | null {
  const state = loadState(ns);
  if (!state) return null;
  const {
    progressBar, financeProgress, traderProgress, hacknetProgress,
    sleeveProgress, sleeveGlobalMode, fillerConfig,
  } = state;
  return {
    progressBar, financeProgress, traderProgress, hacknetProgress,
    sleeveProgress, sleeveGlobalMode, fillerConfig,
  };
}

export function patchProgressState(ns: NS, partialState: ProgressStatePatch): void {
  patchState(ns, partialState as BotStatePatch);
}

export function loadGangState(ns: NS): GangState | null {
  const state = loadState(ns);
  if (!state) return null;
  const {
    hasGang, gangFaction, isHackingGang, gangMembersCount, gangRespect,
    gangWantedPenalty, gangPhase, gangProgress, isBN2GangMode,
  } = state;
  return {
    hasGang, gangFaction, isHackingGang, gangMembersCount, gangRespect,
    gangWantedPenalty, gangPhase, gangProgress, isBN2GangMode,
  };
}

export function patchGangState(ns: NS, partialState: GangStatePatch): void {
  patchState(ns, partialState as BotStatePatch);
}

export function loadState(ns: NS): BotState | null {
  try {
    const port = ns.getPortHandle(STATE_PORT);
    const data = port.peek();
    if (isPortEmpty(data)) return null;
    return data as BotState;
  } catch (error) {
    getLogger(ns).error(`Port ${STATE_PORT} konnte nicht gelesen werden: ${error}`);
    return null;
  }
}

export function clearState(ns: NS): void {
  ns.getPortHandle(STATE_PORT).clear();
  getLogger(ns).info(`Port ${STATE_PORT} erfolgreich geleert.`);
}