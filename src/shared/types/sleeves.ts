import {
  BladeburnerActionTypeForSleeve,
  CompanyName,
  CrimeType,
  FactionName,
  FactionWorkType,
  SleevePerson,
  SleeveTask,
  UniversityClassType,
} from "@ns";
import { BotStrategy } from "./strategy";

export type SleeveMode =
  | "RECOVERY"
  | "SYNCHRO"
  | "TRAIN"
  | "FACTION"
  | "COMPANY"
  | "CRIME"
  | "UNI"
  | "DOMINION"
  | "BLADEBURNER";

export interface SleeveData {
  index: number;
  stats: SleevePerson;
  task: SleeveTask | null;
}

export interface SleeveOptions {
  globalMode?: SleeveMode;
  targetFaction?: FactionName | string | null;
  targetCompany?: CompanyName | string | null;
  targetStat?: string | number | null;
  targetBladeburnerAction?: string | null;
  targetBladeburnerType?: string | null;
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
  targetFaction?: FactionName | string | null;
  targetCompany?: CompanyName | string | null;
  targetStat?: string | number | null;
  targetBladeburnerAction?: string | null;
  targetBladeburnerType?: string | null;
  strategy?: BotStrategy;
  sleeveProgress?: string;
  autoBuyAugs?: boolean;
  isDominionActive?: boolean;
}

export type SleeveTaskAssignment =
  | { mode: "RECOVERY" }
  | { mode: "SYNCHRO" }
  | { mode: "CRIME"; target?: CrimeType }
  | { mode: "COMPANY"; target?: CompanyName | string }
  | {
      mode: "FACTION";
      target?: FactionName | string;
      subType?: FactionWorkType;
    }
  | { mode: "UNI"; target?: string; subType?: UniversityClassType }
  | {
      mode: "BLADEBURNER";
      target?: BladeburnerActionTypeForSleeve | string;
      subType?: string;
    };
