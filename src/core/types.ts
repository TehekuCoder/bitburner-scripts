// src/core/types.ts

import { NS, FactionName, CompanyName, JobField } from "@ns";

export interface ScriptList {
  worker: string;
  dispatcher: string;
  infra: string;
  backdoor: string;
  xpfarm: string;
  trade: string;
  hacknet: string;
  dnet: string;
  crawler: string;
  hack: string;
  grow: string;
  weaken: string;
  sleeve: string;
  dashboard: string;
}

export interface BatchPlan {
  target: string;
  hackThreads: number;
  weaken1Threads: number;
  growThreads: number;
  weaken2Threads: number;
  hackDelay: number;
  weaken1Delay: number;
  growDelay: number;
  weaken2Delay: number;
  // 🟢 Synchronisiert mit utils/batch-calculator.ts
  // 🟢 NEU FÜR JIT: Pure Laufzeiten für die absolute Terminplanung
  hackTime: number;
  growTime: number;
  weakenTime: number;
  totalRam: number;
  executionTime: number;
}

export interface InFlightBatch {
  id: number;
  target: string;
  dispatchTime: number;
  impactStart: number;
  impactEnd: number;
}

export interface WorkerNode {
  hostname: string;
  freeRam: number;
  maxRam: number;
}

export interface JitEvent {
  id: string; // Eindeutige ID (z.B. "batch-42-hack")
  batchId: number; // Zuordnung zur Welle
  script: string; // "tasks/hack.js", etc.
  threads: number;
  target: string;
  startTime: number; // Absoluter Unix-Zeitstempel (Date.now() + X), wann das exec() feuern MUSS
  landTime: number; // Wann der Effekt einschlagen soll (für das Monitoring)
}

export interface DashboardData {
  status: string;
  target: string;
  progress: number;
  progressText: string;
  greed: number;
  ramNeeded: number;
  ramFree: number;
  ramTotal: number;
  batchesSent: number;
  batchesMax: number;
  eventLog: string[];
  lastWaveProfit: number;
}

export interface FactionConfig {
  name: FactionName;
  minStat: number;
  priority: number;
}

export type BotStrategy =
  | "MONEY"
  | "XP_SPRINT"
  | "REP"
  | "CORP"
  | "TRAIN"
  | "KILLS"
  | "CRIME";

export interface SourceFileProgress {
  [sourceFileNumber: number]: number;
}

export type BatchStrategy = 
  | "EHT_LOOP" 
  | "XP_GRIND" 
  | "PREP" 
  | "PROTO_BATCH" 
  | "SHOTGUN_HWGW" 
  | "JIT_HWGW";

export interface BotState {
  strategy: BotStrategy;
  batchStrategy?: BatchStrategy;
  progressBar: string;
  targetFaction?: FactionName;
  targetCompany?: CompanyName;
  targetStat?: number;
  jobField?: JobField;
  targetKills?: number;
  factionTargets?: Partial<Record<FactionName, number>>;
  factionCurrentReps?: Partial<Record<FactionName, number>>;
  batcherProgress?: string;
  batcherRamNeeded?: number;
  batcherTarget?: string;
  batcherActive: boolean;
  fillerConfig?: {
    shareMaxRamPercent: number;
    maxXpLevel: number;
  };
  financeProgress?: string;
  moneyReserve?: number;
  traderMode?: "INACTIVE" | "EARLY" | "4S_ACTIVE" | "LIQUIDATING";
  traderProgress?: string;
  hacknetMode?: "INACTIVE" | "PRODUCTION" | "HASH_SPENDING";
  hacknetProgress?: string;
  sleeveGlobalMode?: "RECOVERY" | "CRIME" | "COMPANY" | "FACTION";
  sleeveProgress?: string;
  targetSleeveCompany?: CompanyName;
  currentBitNode: number;
  currentBitNodeLevel: number;
  sourceFiles: SourceFileProgress;
  hasDarkScapeNavigator: boolean;
  hasTorRouter: boolean;
  hasGang: boolean;
  hasCorporation: boolean;
  hasBladeburner: boolean;
  lastUpdate: number;
  playerHacking: number;
  kernelTarget?: string;
  rootCount?: number;
  totalNodes?: number;
  isFleetMode?: boolean;
  sources?: Record<string, string>;
  allServers?: string[];
  bnMults?: Record<string, number>;
  homeCores?: number;
  isHomePrioritized?: boolean;
  isRushModeActive?: boolean;
  batcherPlan?: any | null;
  batcherDynamicMaxBatches?: number;
}

// --- LOGGER ---
export type LogLevel = "DEBUG" | "INFO" | "SUCCESS" | "WARN" | "ERROR";

export type SleeveMode =
  | "RECOVERY"
  | "SYNCHRO"
  | "TRAIN"
  | "FACTION"
  | "COMPANY"
  | "CRIME";

export interface StrategyResult {
  mode: BotStrategy;
  targetFaction: FactionName | null;
  targetCompany: CompanyName | undefined;
  targetStat: number;
}

export interface UIProgressBarParams {
  mode: BotStrategy;
  label: string;
  currentVal: number;
  targetVal: number;
  etaStr: string;
  targetFaction: FactionName | null;
  playerMoney: number;
  effectiveThreshold: number;
  cachedFallbackTarget: string;
  hasFormulas: boolean;
  canRunBatcher: boolean;
  factionToWorkFor: { name: FactionName } | null;
  isReadyForFactionGrind: boolean;
  crimeMoneyMult: number;
  currentState: any;
}

export interface HacknetUpgrade {
  type: "Level" | "RAM" | "Core" | "Neuer Node";
  cost: number;
  index?: number;
}

export interface ServerAuthDetails {
  isConnectedToCurrentServer: boolean;
  hasSession: boolean;
  modelId: string;
  passwordHint: string;
  data: string;
  logTrafficInterval: number;
  passwordLength: number;
  passwordFormat:
    | "numeric"
    | "alphabetic"
    | "alphanumeric"
    | "ASCII"
    | "unicode";
}

export interface AugShoppingItem {
  faction: FactionName;
  name: string;
  price: number;
  repReq: number;
}

// find-path.ts
export interface NetworkInfo {
  nodes: string[];
  parentMap: Record<string, string>;
}

export type SolverFunction = (ns: NS, host: string, details: any) => Promise<string | null>;