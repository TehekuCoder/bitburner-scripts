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

export interface DnetAuthAttemptState {
  inconclusive: boolean;
}