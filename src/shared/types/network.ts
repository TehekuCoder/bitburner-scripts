import type { NS } from "@ns";

export interface WorkerNode {
  hostname: string;
  freeRam: number;
  maxRam: number;
}

export interface NetworkInfo {
  nodes: string[];
  parentMap: Record<string, string>;
}

export type ServerAuthDetails = ReturnType<NS["dnet"]["getServerDetails"]>;

export type DnetMasterMessage =
  | { type: "password"; host: string; password: string }
  | { type: "cooldown"; host: string; timestamp: number };

export interface DnetHostObservation {
  hostname: string;
  depth: number;
  requiredCharismaSkill: number;
  hasSession: boolean;
  isOnline: boolean;
  isStationary: boolean;
  modelId: string;
  passwordFormat: "numeric" | "alphabetic" | "alphanumeric" | "ASCII" | "unicode";
  passwordLength: number;
  difficulty: number;
  blockedRam: number;
  isConnectedToCurrentServer: boolean;
  observedAt: number;
  observedMutationEpoch: number;
  lastSuccessfulLoginAt: number;
  isStasisLinked: boolean;
}

export interface DnetAuthAttemptState {
  inconclusive: boolean;
}