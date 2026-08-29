import { NS } from "@ns";
import { CorpPhase } from "../../shared/constants/corporation";
import { LoggerClient } from "../../infrastructure/logging/logger-client";
import { LogLevel } from "/shared/types/logger";

export interface CorpPhaseContext {
  ns: NS;
  logger: LoggerClient;
  log: (msg: string, level?: LogLevel) => void;
  currentPhase: CorpPhase;
}

export interface CorpPhaseHandler {
  execute(ctx: CorpPhaseContext): Promise<CorpPhase>;
}

export interface InvestorConfig {
  targetOffer: number;
  nextPhase: CorpPhase;
  divisionNames: string[];
  resetJobs: (ns: NS) => void;
}
