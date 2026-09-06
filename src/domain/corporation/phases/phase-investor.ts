// domain/corporation/phases/phase-investor.ts

import { NS } from "@ns";
import {
  setupOfficeAndJobs,
  maintainEmployeeMorale,
  JobAssignments,
} from "../corporation-helpers";
import { CorpPhaseHandler, CorpPhaseContext, InvestorConfig } from "../types";
import { CORP_CONFIG, CorpPhase } from "../../../shared/constants/corporation";

export class InvestorPhaseHandler implements CorpPhaseHandler {
  private state: "IDLE" | "ACCUMULATING" | "SELLING" = "IDLE";
  private ticks = 0;
  private sellTicks = 0;
  private attempts = 0;
  private maxOfferSeen = 0;

  constructor(private config: InvestorConfig) {}

  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log } = ctx;
    const corp = ns.corporation;

    const expectedRound = ctx.currentPhase === "INVESTOR_1" ? 1 : 2;
    const offer = corp.getInvestmentOffer();

    if (!offer || offer.round > expectedRound) {
      log(
        `Investment-Runde ${expectedRound} bereits erledigt oder nicht verfügbar. Überspringe...`,
        "WARN",
      );
      return this.config.nextPhase;
    }

    for (const div of this.config.divisionNames) {
      for (const city of CORP_CONFIG.cities) {
        maintainEmployeeMorale(ns, div, city);
      }
    }

    // STATE 1: Stoppe Verkäufe & fokussiere Mitarbeiter auf Produktion
    if (this.state === "IDLE") {
      log(
        `Starte Profit-Spike für Investor (${this.config.nextPhase}). Stoppe Verkäufe & maximiere Produktion... (Versuch ${this.attempts + 1}/3)`,
        "INFO",
      );
      for (const div of this.config.divisionNames) {
        for (const city of CORP_CONFIG.cities) {
          const office = corp.getOffice(div, city);
          setupOfficeAndJobs(ns, div, city, office.size, {
            Operations: Math.floor(office.size / 2),
            Engineer: Math.ceil(office.size / 2),
          });

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

    // STATE 2: Warten auf gefüllte Lager
    if (this.state === "ACCUMULATING") {
      this.ticks++;

      let isFull = true;
      for (const div of this.config.divisionNames) {
        for (const city of CORP_CONFIG.cities) {
          const mainMat =
            div === CORP_CONFIG.divisions.chem.name ? "Chemicals" : "Plants";
          const mat = corp.getMaterial(div, city, mainMat);

          if (mat.stored < 500) {
            isFull = false;
          }
        }
      }

      if (!isFull && this.ticks < 15) return ctx.currentPhase;

      log("Lager gefüllt. Schalte auf MAX-DUMP & Business-Spike um...", "INFO");
      for (const div of this.config.divisionNames) {
        for (const city of CORP_CONFIG.cities) {
          const officeSize = corp.getOffice(div, city).size;

          const spikeJobs: JobAssignments =
            officeSize >= 9
              ? CORP_CONFIG.jobDistribution.spike9
              : { Operations: 1, Business: Math.max(1, officeSize - 1) };

          setupOfficeAndJobs(ns, div, city, officeSize, spikeJobs);

          // "0" erzwingt sofortigen Abverkauf der gesamten Lagerbestände in einem Tick
          corp.sellMaterial(div, city, "Plants", "MAX", "0");
          corp.sellMaterial(div, city, "Food", "MAX", "0");
          if (div === CORP_CONFIG.divisions.chem.name) {
            corp.sellMaterial(div, city, "Chemicals", "MAX", "0");
          }
        }
      }
      this.state = "SELLING";
      this.sellTicks = 0;
      return ctx.currentPhase;
    }

    // STATE 3: Angebot evaluieren & annehmen
    if (this.state === "SELLING") {
      this.sellTicks++;
      const currentOffer = corp.getInvestmentOffer();
      const funds = currentOffer ? currentOffer.funds : 0;

      if (funds > this.maxOfferSeen) {
        this.maxOfferSeen = funds;
      }

      log(
        `Investor Angebot: $${ns.format.number(funds)} / Ziel: $${ns.format.number(this.config.targetOffer)} (Sell-Tick ${this.sellTicks}/5)`,
        "INFO",
      );

      if (funds >= this.config.targetOffer) {
        if (corp.acceptInvestmentOffer()) {
          log(
            `Investment von $${ns.format.number(funds)} erfolgreich angenommen!`,
            "SUCCESS",
          );
          this.resetState(ns);
          return this.config.nextPhase;
        }
      }

      if (this.sellTicks >= 5) {
        this.attempts++;

        if (this.attempts >= 3) {
          // Dynamischer Plateau-Akzeptanzwert (80% des Zielangebots)
          const minAcceptable = this.config.targetOffer * 0.8;

          if (funds >= minAcceptable && corp.acceptInvestmentOffer()) {
            log(
              `Ziel $${ns.format.number(this.config.targetOffer)} nicht erreicht, aber Plateau bei $${ns.format.number(funds)} erfolgreich angenommen!`,
              "SUCCESS",
            );
            this.resetState(ns);
            return this.config.nextPhase;
          }

          const fallback = this.config.fallbackPhase ?? ctx.currentPhase;
          log(
            `Angebot stagnierte bei $${ns.format.number(funds)}. Kehre zu ${fallback} zurück...`,
            "WARN",
          );
          this.resetState(ns);
          return fallback;
        }

        log(
          `Spike-Fenster abgelaufen (Versuch ${this.attempts}/3). Neustart...`,
          "WARN",
        );
        this.config.resetJobs(ns);
        this.state = "IDLE";
      }

      return ctx.currentPhase;
    }

    return ctx.currentPhase;
  }

  private resetState(ns: NS): void {
    this.config.resetJobs(ns);
    this.state = "IDLE";
    this.attempts = 0;
    this.maxOfferSeen = 0;
  }
}