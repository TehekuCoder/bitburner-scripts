export type BatchStrategy =
  | "BOOTSTRAP"
  | "XP_GRIND"
  | "PREP"
  | "PROTO_BATCH"
  | "SHOTGUN_HWGW"
  | "JIT_HWGW";

export interface BatchPlan {
  target: string;

  // Threads
  hackThreads: number;
  weakenThreads1: number;
  growThreads: number;
  weakenThreads2: number;

  // Delays & Laufzeiten
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

export interface JitEvent {
  id: string;
  batchId: number;
  script: string;
  threads: number;
  target: string;
  startTime: number;
  landTime: number;
}

export interface TargetSummary {
  target: string;
  mode: "PREP" | "HWGW";
  activeBatches: number;
  maxBatches: number;
  prepEndTime: number;
  greed: number;
}

export interface ActiveBatch {
  id: number;
  executedEventsCount: number;
  totalEventsCount: number;
  landEndTime: number;
}

export interface MultiTargetState {
  target: string;
  phase: "PREP" | "HWGW";
  moneyPercent: number;
  activeBatches: number;
  maxBatches: number;
  estimatedIncomePerSec: number;
}

export interface BatcherState {
  batcherTarget?: string | null;
  batcherProgress: string;
  batcherActive?: boolean;
  batcherActiveBatches?: number;
  batcherTargetsSummary?: TargetSummary[];
  batcherPlan?: BatchPlan | null;
  batcherDynamicMaxBatches?: number;
  batcherRamNeeded?: number;
}