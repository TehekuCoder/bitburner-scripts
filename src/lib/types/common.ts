import { NS, FactionName } from "@ns";
import { LoggerClient } from "../logger-client";
import { BotStrategy } from "./strategy";
import { TargetSummary } from "./batcher";

export interface ScriptList {
  // Observability
  perfMonitor: string;
  logger: string;
  //-------------------------

  // Finanz-Verwaltung
  financeDispatcher?: string;
  financeCore: string;
  //-------------------------

  // Hacking-Payloads
  worker: string;
  hack: string;
  grow: string;
  weaken: string;
  //-------------------------

  // Orchestrator
  sysOrchestrator: string;

  // Batcher
  batchOrchestrator: string;
  //-------------------------

  // Share
  fillShare: string;
  //-------------------------

  // Kontrakte
  cctSolver: string;

  // Darknet
  dnet: string;
  crawler: string;
  //-------------------------

  // Singularity
  sysDispatcher: string;
  backdoor: string;
  augAnalyze: string;
  //-------------------------

  // Sleeve
  sleeve: string;
  //-------------------------

  // Gang
  gang: string;
  //-------------------------

  // Hacknet
  hashManager: string;
  //-------------------------
}

export interface SourceFileProgress {
  [sourceFileNumber: number]: number;
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

export interface FinanceState {
  traderMode?: string;
  traderProgress: string;
  financeProgress: string;
  moneyReserve?: number;
  isHomePrioritized?: boolean;
  isRushModeActive?: boolean;
  homeCores?: number;
}

export interface HacknetUpgrade {
  type: "Level" | "RAM" | "Core" | "Neuer Node";
  cost: number;
  index?: number;
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

export type SolverFunction = (
  ns: NS,
  host: string,
  details: any,
  logger?: LoggerClient,
) => Promise<string | null> | string | null;
