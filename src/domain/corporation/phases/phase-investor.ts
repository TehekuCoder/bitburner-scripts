// domain/corporation/phases/phase-investor.ts

import { NS } from "@ns";
import {
  setupOfficeAndJobs,
  maintainEmployeeMorale,
} from "../corporation-helpers";
import { CorpPhaseHandler, CorpPhaseContext, InvestorConfig } from "../types";
import { CORP_CONFIG, CorpPhase } from "/shared/constants/corporation";

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

    // Morale aufrechterhalten, damit die Produktivität nicht einbricht
    for (const div of this.config.divisionNames) {
      for (const city of CORP_CONFIG.cities) {
        maintainEmployeeMorale(ns, div, city);
      }
    }

    // STATE 1: Stoppe Verkäufe, um Rohstoffe/Produkte aufzustauen
    if (this.state === "IDLE") {
      log(
        `Starte Profit-Spike für Investor (${this.config.nextPhase}). Stoppe Verkäufe... (Versuch ${this.attempts + 1}/3)`,
        "INFO",
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

    // STATE 2: Warten, bis Lagerhäuser gefüllt sind (oder Timeout nach 15 Ticks)
    if (this.state === "ACCUMULATING") {
      this.ticks++;

      // Statt wh.sizeUsed / wh.size < 0.9
      // Messen wir explizit die gelagerten Verkaufsprodukte
      let isFull = true;
      for (const div of this.config.divisionNames) {
        for (const city of CORP_CONFIG.cities) {
          const mainMat =
            div === CORP_CONFIG.divisions.chem.name ? "Chemicals" : "Plants";
          const mat = corp.getMaterial(div, city, mainMat);

          // Warten, bis mindestens 500 Einheiten des Hauptprodukts angestaut wurden
          if (mat.stored < 500) {
            isFull = false;
          }
        }
      }

      if (!isFull && this.ticks < 15) return ctx.currentPhase;

      log(
        "Lager gefüllt. Öffne Ventile & passe Jobs für Maximal-Profit an...",
        "INFO",
      );
      for (const div of this.config.divisionNames) {
        for (const city of CORP_CONFIG.cities) {
          setupOfficeAndJobs(
            ns,
            div,
            city,
            9,
            CORP_CONFIG.jobDistribution.spike9,
          );
          corp.sellMaterial(div, city, "Plants", "MAX", "MP");
          corp.sellMaterial(div, city, "Food", "MAX", "MP");
          if (div === CORP_CONFIG.divisions.chem.name) {
            corp.sellMaterial(div, city, "Chemicals", "MAX", "MP");
          }
        }
      }
      this.state = "SELLING";
      this.sellTicks = 0;
      return ctx.currentPhase;
    }

    // STATE 3: Abwarten, bis das Angebot das Ziel erreicht (max. 5 Ticks)
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

      // 1. Primäres Ziel erreicht
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

      // 2. Ende des Verkauf-Fensters erreicht
      if (this.sellTicks >= 5) {
        this.attempts++;

        // Nach 3 erfolglosen Versuchen: Angebot stagnierte
        if (this.attempts >= 3) {
          // Akzeptiere ein starkes Plateau Angebot ab $400b für den Übergang zu Tobacco
          if (funds >= 400e9 && corp.acceptInvestmentOffer()) {
            log(
              `Ziel $${ns.format.number(this.config.targetOffer)} nicht erreicht, aber Plateau bei $${ns.format.number(funds)} erfolgreich angenommen!`,
              "SUCCESS",
            );
            this.resetState(ns);
            return this.config.nextPhase;
          }

          // Falls zu niedrig: Zurück zu EXPORT_LOOP für weiteres Ausbauen
          log(
            `Angebot stagnierte bei $${ns.format.number(funds)}. Kehre zu EXPORT_LOOP zurück, um weiter zu skalieren.`,
            "WARN",
          );
          this.resetState(ns);
          return "EXPORT_LOOP";
        }

        log(
          `Spike-Fenster abgelaufen (Versuch ${this.attempts}/3). Ziel nicht erreicht. Starte neuen Anlauf...`,
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
