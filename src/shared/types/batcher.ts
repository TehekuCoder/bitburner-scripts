// Single Source of Truth für alle Hacking- & Execution-Strategien
export type BatchStrategy =
  | "WORKER"
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
  weaken1Threads: number;
  growThreads: number;
  weaken2Threads: number;

  // Delays & Laufzeiten (Optional für JIT-Batching)
  hackDelay?: number;
  weaken1Delay?: number;
  growDelay?: number;
  weaken2Delay?: number;
  hackTime: number;
  growTime: number;
  weakenTime: number;
  executionTime?: number;

  // RAM & Orchestrierung
  totalRam?: number;
  batchRam: number;
  maxBatches?: number;
  greed?: number;
  greedScore?: number;
  greedFactor?: number;
}

export interface TargetContext {
  target: string;
  plan: BatchPlan;
  dynamicMaxBatches: number;
  batchesSent: number;
  nextAvailableLandTime: number;
  prepEndTime: number;
  activeBatchIds: Set<number>;
  lastRamBlockedTime?: number;
  ramCooldown?: number;
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
  batchRam?: number;
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
  batchStrategy?: BatchStrategy;
  batcherPhase?: string;
  batcherTarget?: string | null;
  batcherProgress: string;
  batcherActive?: boolean;
  batcherActiveBatches?: number;
  batcherTargetsSummary?: TargetSummary[];
  batcherPlan?: BatchPlan | null;
  batcherDynamicMaxBatches?: number;
  batcherRamNeeded?: number;
}

export type DispatchResult = "SUCCESS" | "NO_RAM" | "EXEC_FAIL";

// engine-proto
export type EngineMode = "WEAKEN" | "GROW" | "HARVEST" | "UNKNOWN";

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