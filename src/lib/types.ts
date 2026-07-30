import {
  NS,
  FactionName,
  CompanyName,
  JobField,
  SleevePerson,
  SleeveTask,
} from "@ns";
import { LoggerClient } from "./logger-client";

export interface AugmentRoadmapItem {
  faction: FactionName | string;
  augmentation: string;
  repRequired: number;
  cost: number;
}

export interface ScriptList {
  logger: string;
  perfMonitor: string;
  worker: string;
  dispatcher: string;
  infra: string;
  backdoor: string;
  trade: string;
  hacknet: string;
  dnet: string;
  crawler: string;
  hack: string;
  grow: string;
  weaken: string;
  sleeve: string;
  fillShare: string;
  augShopping: string;
  augAnalyze: string;
  orchestrator: string;
  suites: string;
  gang: string;
}

export interface BatchPlan {
  target: string;

  // Threads
  hackThreads: number;
  weakenThreads1: number;
  growThreads: number;
  weakenThreads2: number;

  // Delays & Laufzeiten (essentiell für das Timing im Batcher)
  hackDelay: number;
  weaken1Delay: number;
  growDelay: number;
  weaken2Delay: number;
  hackTime: number;
  growTime: number;
  weakenTime: number;
  executionTime: number;

  // RAM & Orchestrierung
  totalRam: number;
  batchRam: number;
  maxBatches?: number;
  greed?: number;
  greedFactor?: number;
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
  id: string;
  batchId: number;
  script: string;
  threads: number;
  target: string;
  startTime: number;
  landTime: number;
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
  targetsSummary?: TargetSummary[];
}

export interface FactionConfig {
  name: FactionName;
  minStat: number;
  priority: number;
}

export type BotStrategy =
  | "MONEY"
  | "REP"
  | "CORP"
  | "TRAIN"
  | "KILLS"
  | "CRIME";

export interface SourceFileProgress {
  [sourceFileNumber: number]: number;
}

export type BatchStrategy =
  | "BOOTSTRAP"
  | "XP_GRIND"
  | "PREP"
  | "PROTO_BATCH"
  | "SHOTGUN_HWGW"
  | "JIT_HWGW";

export interface TargetSummary {
  target: string;
  mode: "PREP" | "HWGW";
  activeBatches: number;
  maxBatches: number;
  prepEndTime: number;
  greed: number;
}

export interface BotStateStrategy {
  strategy: BotStrategy;
  batchStrategy?: BatchStrategy;
  kernelTarget: string;
  targetFaction?: string | FactionName | null;
  targetCompany?: string;
  targetStat?: number;
  targetKills?: number;
}

export interface BatcherState {
  batcherTarget?: string | null;
  batcherProgress: string;
  batcherActive: boolean;
  batcherTargetsSummary?: TargetSummary[];
  batcherPlan?: BatchPlan | null;
  batcherDynamicMaxBatches?: number;
  batcherRamNeeded?: number;
}

export interface StrategyState {
  strategy: BotStrategy;
  targetFaction?: string | FactionName | null;
  targetCompany?: string;
  targetStat?: number;
  targetKills?: number;
}

export interface FinanceState {
  traderMode?: string;
  traderProgress: string;
  financeProgress: string;
  moneyReserve?: number;
  isHomePrioritized?: boolean;
  isRushModeActive?: boolean;
  homeCores?: number;
}

export interface SleeveState {
  sleeveGlobalMode?: string;
  targetFaction?: string | FactionName | null;
  targetStat?: number;
  strategy: BotStrategy;
  sleeveProgress?: string;
}

export interface AugmentState {
  augRoadMap?: AugmentTarget[];
  isBN2GangMode?: boolean; // ➕ Hier ergänzt
}

export interface FactionState {
  targetFaction?: string | FactionName | null;
  factionCurrentReps?: Partial<Record<FactionName, number>>;
  strategy: BotStrategy;
}

export interface BotStateProgress {
  progressBar?: string;
  financeProgress: string;
  traderProgress: string;
  hacknetProgress: string;
  sleeveProgress?: string;
  sleeveGlobalMode?: string;
  fillerConfig?: {
    shareMaxRamPercent: number;
    maxXpLevel: number;
  };
}

export interface BotStateNetwork {
  factionTargets?: Record<string, number>;
  augRoadMap?: AugmentTarget[];
  allServers?: string[];
  totalNodes?: number;
  rootCount?: number;
}

export interface BotStateMeta {
  currentBitNode: number;
  currentBitNodeLevel: number;
  sourceFiles: Record<string, number>;
  hasDarkScapeNavigator: boolean;
  hasTorRouter: boolean;
  hasGang: boolean;
  hasCorporation: boolean;
  hasBladeburner: boolean;
  lastUpdate: number;
  playerHacking?: number;
  sources?: Record<string, string>;
  traderMode?: string;
  moneyReserve?: number;
  isHomePrioritized?: boolean;
  factionCurrentReps?: Partial<Record<FactionName, number>>;
  homeCores?: number;
  isRushModeActive?: boolean;
}

export interface BotState
  extends BotStateStrategy,
    BotStateProgress,
    BotStateNetwork,
    BotStateMeta,
    GangState,
    BatcherState,
    AugmentState {} // ➕ AugmentState hier zur Schnittstelle hinzugefügt

export interface SleeveOptions {
  globalMode?: SleeveMode;
  targetFaction?: FactionName | string | null;
  targetStat?: number;
  strategy?: BotStrategy;
}

export type SleeveMode =
  | "RECOVERY"
  | "SYNCHRO"
  | "TRAIN"
  | "FACTION"
  | "COMPANY"
  | "CRIME";

export interface StrategyResult {
  mode: BotStrategy;
  targetFaction?: FactionName | null;
  targetCompany?: CompanyName;
  targetStat?: number;
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

export interface NetworkInfo {
  nodes: string[];
  parentMap: Record<string, string>;
}

export type SolverFunction = (
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient
) => Promise<string | null> | string | null;

export interface SleeveData {
  index: number;
  stats: SleevePerson;
  task: SleeveTask | null;
}

export interface AugmentTarget {
  name: string;
  repReq: number;
  basePrice: number;
  prereqs: string[];
  factions: FactionName[];
  bestFaction: FactionName;
}

export interface TargetFactionResult {
  name: FactionName;
  targetRep: number;
  augName: string;
}

export interface ActiveBatch {
  id: number;
  executedEventsCount: number;
  totalEventsCount: number;
  landEndTime: number;
}

export type LogLevel = "DEBUG" | "INFO" | "SUCCESS" | "WARN" | "ERROR";

export interface LoggerContext {
  target?: string;
  tags?: string[];
  context?: Record<string, string | number | boolean | null | undefined>;
}

export interface LogPayload {
  module: string;
  level: LogLevel;
  msg: string;
  timestamp: number;
  target?: string;
  tags?: string[];
  context?: Record<string, string | number | boolean | null | undefined>;
}

export interface MultiTargetState {
  target: string;
  phase: "PREP" | "HWGW";
  moneyPercent: number;
  activeBatches: number;
  maxBatches: number;
  estimatedIncomePerSec: number;
}

export interface GangState {
  hasGang: boolean;
  gangFaction?: FactionName;
  isHackingGang?: boolean;
  gangMembersCount?: number;     // z. B. 8 (von 12)
  gangRespect?: number;          // Aktueller Ruf der Gang
  gangWantedPenalty?: number;    // Multiplikator/Penalty (z.B. 0.95 = 5% Makel)
  gangPhase?: string;            // z. B. "RECRUITING", "TRAINING", "TERRITORY", "FARMIN_REP"
  gangProgress?: string;         // Für UI/UI-Helper ("12/12 Members | Rep: 2.4M")
}