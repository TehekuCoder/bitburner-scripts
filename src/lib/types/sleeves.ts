import { CompanyName, FactionName, SleevePerson, SleeveTask } from "@ns";
import { BotStrategy } from "./strategy";

export type SleeveMode =
  | "RECOVERY"
  | "SYNCHRO"
  | "TRAIN"
  | "FACTION"
  | "COMPANY"
  | "CRIME"
  | "UNI"
  | "DOMINION";

export interface SleeveData {
  index: number;
  stats: SleevePerson;
  task: SleeveTask | null;
}

export interface SleeveOptions {
  globalMode?: SleeveMode;
  targetFaction?: FactionName | string | null;
  targetCompany?: CompanyName | string | null; // ◄ Neu hinzugefügt
  targetStat?: number;
  strategy?: BotStrategy;
  autoBuyAugs?: boolean;
  isDominionActive?: boolean;
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
  targetCompany?: string | CompanyName | null; // ◄ Neu hinzugefügt
  targetStat?: number;
  strategy: BotStrategy;
  sleeveProgress?: string;
  autoBuyAugs?: boolean;
  isDominionActive?: boolean;
}