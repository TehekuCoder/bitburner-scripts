import { FactionName, CompanyName } from "@ns";
import { BatchStrategy, BatcherState } from "./batcher";
import { GangState } from "./gang";
import { AugmentState, FactionState } from "./factions";
import { SleeveState } from "./sleeves";
import { FinanceState } from "./finance";
import { CorporationState } from "./corporation";

export type BotStrategy =
  | "MANUAL"
  | "MONEY"
  | "REP"
  | "COMPANY"
  | "TRAIN"
  | "KILLS"
  | "CRIME"
  | "UNI"
  | "KARMA"
  | "BLADEBURNER"
  | "CHURCH"
  | "DOMINION";

export interface StrategyState {
  strategy?: BotStrategy;
  targetFaction?: FactionName | string | null;
  targetCompany?: CompanyName | string | null;
  targetStat?: string | number | null;
  targetKills?: number;
  manualMode?: boolean;
  isGrindingNFG?: boolean;
  isDominionActive?: boolean;
}

export interface StrategyResult {
  mode: BotStrategy;
  targetFaction?: FactionName | null;
  targetCompany?: CompanyName | null;
  targetStat?: string | number | null;
}

export interface BitnodePhaseInfo {
  phaseIndex: number;
  phaseName: string;
  progressPercent: number;
  detail: string;
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
  bitnodePhaseInfo?: BitnodePhaseInfo;
}

/**
  * Master-State für das gesamte BotState-System.
  * Bündelt alle domänenspezifischen Sub-States ohne Redundanzen.
  */
export interface BotState
  extends StrategyState,
    BatcherState,
    FinanceState,
    SleeveState,
    AugmentState,
    FactionState,
    BotStateProgress,
    GangState,
    CorporationState {
  // Metadata & System Runtime
  lastUpdate: number;
  playerHacking?: number;
  sources?: Record<string, string>;

  // Global BitNode State & Unlocks
  currentBitNode: number;
  currentBitNodeLevel: number;
  sourceFiles: Record<string | number, number>;
  hasDarkScapeNavigator: boolean;
  hasTorRouter: boolean;
  hasCorporation: boolean;
  hasBladeburner: boolean;

  // Infrastructure & Network
  kernelTarget: string;
  allServers?: string[];
  totalNodes?: number;
}