import { FactionName, CompanyName } from "@ns";
import { BatchStrategy, BatcherState } from "./batcher";
import { GangState } from "./gang";
import { AugmentState, AugmentTarget } from "./factions";

export type BotStrategy =
  | "MONEY"
  | "REP"
  | "CORP"
  | "TRAIN"
  | "KILLS"
  | "CRIME"
  | "UNI";

export interface BotStateStrategy {
  strategy: BotStrategy;
  batchStrategy?: BatchStrategy;
  kernelTarget: string;
  targetFaction?: string | FactionName | null;
  targetCompany?: string;
  targetStat?: number;
  targetKills?: number;
}

export interface StrategyState {
  strategy: BotStrategy;
  targetFaction?: string | FactionName | null;
  targetCompany?: string;
  targetStat?: number;
  targetKills?: number;
}

export interface StrategyResult {
  mode: BotStrategy;
  targetFaction?: FactionName | null;
  targetCompany?: CompanyName;
  targetStat?: number;
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
  } | null;
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
    AugmentState {}