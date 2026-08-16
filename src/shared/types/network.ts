export interface WorkerNode {
  hostname: string;
  freeRam: number;
  maxRam: number;
}

export interface NetworkInfo {
  nodes: string[];
  parentMap: Record<string, string>;
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