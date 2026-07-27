import {
  NS,
  FactionName,
  CompanyName,
  JobField,
  SleevePerson,
  SleeveTask,
} from "@ns";

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

export interface BotState {
  strategy: BotStrategy;
  batchStrategy?: string;
  kernelTarget: string;
  batcherTarget?: string | null;
  progressBar?: string;
  batcherProgress: string;
  batcherActive: boolean;
  financeProgress: string;
  traderProgress: string;
  hacknetProgress: string;

  sleeveProgress?: string;
  sleeveGlobalMode?: string;

  factionTargets?: Record<string, number>;
  augRoadMap?: AugmentTarget[];
  targetFaction?: string | FactionName | null;
  targetCompany?: string;
  targetStat?: number;
  targetKills?: number;

  fillerConfig?: {
    shareMaxRamPercent: number;
    maxXpLevel: number;
  };

  // Globales Netzwerk & Multi-Target State
  allServers?: string[];
  totalNodes?: number;
  batcherTargetsSummary?: TargetSummary[];
  batcherPlan?: BatchPlan | null;
  batcherDynamicMaxBatches?: number;
  batcherRamNeeded?: number;

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

  rootCount?: number;
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

export interface NetworkInfo {
  nodes: string[];
  parentMap: Record<string, string>;
}

export type SolverFunction = (
  ns: NS,
  host: string,
  details: any,
) => Promise<string | null>;

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
