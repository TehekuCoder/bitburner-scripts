import { CorpPhase, CORP_CONFIG } from "../../../shared/constants/corporation";
import { setupOfficeAndJobs } from "../corporation-helpers";
import { CorpPhaseContext, CorpPhaseHandler } from "../types";

export interface InvestorConfig {
  divisionNames: string[];
  targetOffer: number;
  nextPhase: CorpPhase;
  resetJobs: (ns: any) => void;
}

export class InvestorPhaseHandler implements CorpPhaseHandler {
  private state: "IDLE" | "ACCUMULATING" | "SELLING" = "IDLE";
  private ticks = 0;

  constructor(private config: InvestorConfig) {}

  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log } = ctx;
    const corp = ns.corporation;

    // Falls die Investmentrunde bereits abgeschlossen wurde (z.B. nach Skriptneustart)
    const expectedRound = ctx.currentPhase === "INVESTOR_1" ? 1 : 2;
    if (corp.getInvestmentOffer().round > expectedRound) {
      log(`[CORP] Investment-Runde ${expectedRound} bereits erledigt. Überspringe...`);
      return this.config.nextPhase;
    }

    if (this.state === "IDLE") {
      log(`[CORP] Starte Profit-Spike für Investor (${this.config.nextPhase})...`);
      for (const div of this.config.divisionNames) {
        for (const city of CORP_CONFIG.cities) {
          corp.sellMaterial(div, city, "Plants", "0", "MP");
          corp.sellMaterial(div, city, "Food", "0", "MP");
          if (div === "Chemicals") corp.sellMaterial(div, city, "Chemicals", "0", "MP");
        }
      }
      this.state = "ACCUMULATING";
      this.ticks = 0;
      return ctx.currentPhase;
    }

    if (this.state === "ACCUMULATING") {
      this.ticks++;
      if (this.ticks < 2) return ctx.currentPhase;

      log("[CORP] Öffne Ventile & verändere Job-Verteilung auf Spike...");
      for (const div of this.config.divisionNames) {
        for (const city of CORP_CONFIG.cities) {
          setupOfficeAndJobs(ns, div, city, 6, { Business: 3, Operations: 3 });
          corp.sellMaterial(div, city, "Plants", "MAX", "MP");
          corp.sellMaterial(div, city, "Food", "MAX", "MP");
          if (div === "Chemicals") corp.sellMaterial(div, city, "Chemicals", "MAX", "MP");
        }
      }
      this.state = "SELLING";
      return ctx.currentPhase;
    }

    if (this.state === "SELLING") {
      const offer = corp.getInvestmentOffer();
      log(`[CORP] Investor Angebot: $${ns.format.number(offer.funds)} / Ziel: $${ns.format.number(this.config.targetOffer)}`);

      if (offer.funds >= this.config.targetOffer) {
        corp.acceptInvestmentOffer();
        log(`[CORP] Investment von $${ns.format.number(offer.funds)} angenommen!`);
        this.config.resetJobs(ns);
        this.state = "IDLE";
        return this.config.nextPhase;
      }

      // Solange das Ziel nicht erreicht ist, in der Phase bleiben und weiter akkumulieren
      return ctx.currentPhase;
    }

    return ctx.currentPhase;
  }
}