// src/core/types.ts

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
// core/types.ts

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