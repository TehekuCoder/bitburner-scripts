import { NS } from "@ns";
import { CorpPhase, CORP_CONFIG } from "../../../shared/constants/corporation";
import { setupOfficeAndJobs } from "../corporation-helpers";
import { CorpPhaseContext, CorpPhaseHandler } from "../types";

export interface InvestorConfig {
  divisionNames: string[];
  targetOffer: number;
  nextPhase: CorpPhase;
  resetJobs: (ns: NS) => void;
}

export class InvestorPhaseHandler implements CorpPhaseHandler {
  private state: "IDLE" | "ACCUMULATING" | "SELLING" = "IDLE";
  private ticks = 0;

  constructor(private config: InvestorConfig) {}

  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log } = ctx;
    const corp = ns.corporation;

    const expectedRound = ctx.currentPhase === "INVESTOR_1" ? 1 : 2;
    const offer = corp.getInvestmentOffer();

    if (!offer || offer.round > expectedRound) {
      log(
        `Investment-Runde ${expectedRound} bereits erledigt oder nicht verfügbar. Überspringe...`,
        "WARN"
      );
      return this.config.nextPhase;
    }

    // STATE 1: Stoppe Verkäufe, um Rohstoffe/Produkte aufzustauen
    if (this.state === "IDLE") {
      log(
        `Starte Profit-Spike für Investor (${this.config.nextPhase}). Stoppe Verkäufe...`,
        "INFO"
      );
      for (const div of this.config.divisionNames) {
        for (const city of CORP_CONFIG.cities) {
          corp.sellMaterial(div, city, "Plants", "0", "MP");
          corp.sellMaterial(div, city, "Food", "0", "MP");
          if (div === CORP_CONFIG.divisions.chem.name) {
            corp.sellMaterial(div, city, "Chemicals", "0", "MP");
          }
        }
      }
      this.state = "ACCUMULATING";
      this.ticks = 0;
      return ctx.currentPhase;
    }

    // STATE 2: Warten, bis Lagerhäuser gefüllt sind (oder Timeout)
    if (this.state === "ACCUMULATING") {
      this.ticks++;

      let isFull = true;
      for (const div of this.config.divisionNames) {
        for (const city of CORP_CONFIG.cities) {
          const wh = corp.getWarehouse(div, city);
          if (wh.sizeUsed / wh.size < 0.9) {
            isFull = false;
          }
        }
      }

      if (!isFull && this.ticks < 15) return ctx.currentPhase;

      log(
        "Lager gefüllt. Öffne Ventile & passe Jobs für Maximal-Profit an...",
        "INFO"
      );
      for (const div of this.config.divisionNames) {
        for (const city of CORP_CONFIG.cities) {
          setupOfficeAndJobs(ns, div, city, 9, CORP_CONFIG.jobDistribution.spike9);
          corp.sellMaterial(div, city, "Plants", "MAX", "MP");
          corp.sellMaterial(div, city, "Food", "MAX", "MP");
          if (div === CORP_CONFIG.divisions.chem.name) {
            corp.sellMaterial(div, city, "Chemicals", "MAX", "MP");
          }
        }
      }
      this.state = "SELLING";
      return ctx.currentPhase;
    }

    // STATE 3: Abwarten, bis das Angebot das Ziel erreicht
    if (this.state === "SELLING") {
      const currentOffer = corp.getInvestmentOffer();
      const funds = currentOffer ? currentOffer.funds : 0;

      log(
        `Investor Angebot: $${ns.format.number(funds)} / Ziel: $${ns.format.number(this.config.targetOffer)}`,
        "INFO"
      );

      if (funds >= this.config.targetOffer) {
        if (corp.acceptInvestmentOffer()) {
          log(
            `Investment von $${ns.format.number(funds)} erfolgreich angenommen!`,
            "SUCCESS"
          );
          this.config.resetJobs(ns);
          this.state = "IDLE";
          return this.config.nextPhase;
        }
      }

      return ctx.currentPhase;
    }

    return ctx.currentPhase;
  }
}