import { NS } from "@ns";
import { CorpPhase } from "/shared/constants/corporation";

export interface CorpPhaseContext {
  ns: NS;
  log: (msg: string) => void;
  currentPhase: CorpPhase;
}

export interface CorpPhaseHandler {
  execute(ctx: CorpPhaseContext): Promise<CorpPhase>;
}

