import { FactionName, SleevePerson, SleeveTask } from "@ns";
import { BotStrategy } from "./strategy";

export type SleeveMode =
  | "RECOVERY"
  | "SYNCHRO"
  | "TRAIN"
  | "FACTION"
  | "COMPANY"
  | "CRIME"
  | "UNI";

export interface SleeveData {
  index: number;
  stats: SleevePerson;
  task: SleeveTask | null;
}

export interface SleeveOptions {
  globalMode?: SleeveMode;
  targetFaction?: FactionName | string | null;
  targetStat?: number;
  strategy?: BotStrategy;
  autoBuyAugs?: boolean;
}

export interface SleeveGangUnlockStatus {
  hasSleeves: boolean;
  hasGangApi: boolean;
  inGang: boolean;
  shouldGrindKarma: boolean;
}

export interface SleeveState {
  sleeveGlobalMode?: string;
  targetFaction?: string | FactionName | null;
  targetStat?: number;
  strategy: BotStrategy;
  sleeveProgress?: string;
  autoBuyAugs?: boolean;
}