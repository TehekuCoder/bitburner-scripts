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
  id: string;          // Eindeutige ID (z.B. "batch-42-hack")
  batchId: number;     // Zuordnung zur Welle
  script: string;      // "tasks/hack.js", etc.
  threads: number;
  target: string;
  startTime: number;   // Absoluter Unix-Zeitstempel (Date.now() + X), wann das exec() feuern MUSS
  landTime: number;    // Wann der Effekt einschlagen soll (für das Monitoring)
}