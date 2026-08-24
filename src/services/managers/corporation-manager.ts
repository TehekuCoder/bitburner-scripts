import { NS } from "@ns";
import { CORP_CONFIG, CorpPhase } from "../../shared/constants/corporation";
import { patchCorporationState } from "../../infrastructure/state/state";
import { setupOfficeAndJobs } from "../../domain/corporation/corporation-helpers";
import { CorpPhaseHandler } from "../../domain/corporation/types";

// Import aller Phasen-Handler
import {
  InitAgriPhaseHandler,
  AgriBoostPhaseHandler,
} from "../../domain/corporation/phases/phase-agri";
import { InvestorPhaseHandler } from "../../domain/corporation/phases/phase-investor";
import {
  InitChemPhaseHandler,
  ExportLoopPhaseHandler,
} from "../../domain/corporation/phases/phase-chem";
import {
  InitTobaccoPhaseHandler,
  TobaccoLoopPhaseHandler,
} from "../../domain/corporation/phases/phase-tobacco";

// Registrierung der Handlungs-Strategien für jede Phase
const handlers: Record<CorpPhase, CorpPhaseHandler> = {
  INIT_AGRI: new InitAgriPhaseHandler(),
  AGRI_BOOST: new AgriBoostPhaseHandler(),

  INVESTOR_1: new InvestorPhaseHandler({
    divisionNames: [CORP_CONFIG.divisions.agri.name],
    targetOffer: 200_000_000_000,
    nextPhase: "INIT_CHEM",
    resetJobs: (ns) => {
      for (const city of CORP_CONFIG.cities) {
        setupOfficeAndJobs(
          ns,
          CORP_CONFIG.divisions.agri.name,
          city,
          6,
          CORP_CONFIG.jobDistribution.support6,
        );
      }
    },
  }),

  INIT_CHEM: new InitChemPhaseHandler(),
  EXPORT_LOOP: new ExportLoopPhaseHandler(),

  INVESTOR_2: new InvestorPhaseHandler({
    divisionNames: [
      CORP_CONFIG.divisions.agri.name,
      CORP_CONFIG.divisions.chem.name,
    ],
    targetOffer: 2_000_000_000_000,
    nextPhase: "INIT_TOBACCO",
    resetJobs: (ns) => {
      for (const city of CORP_CONFIG.cities) {
        setupOfficeAndJobs(
          ns,
          CORP_CONFIG.divisions.agri.name,
          city,
          6,
          CORP_CONFIG.jobDistribution.support6,
        );
        setupOfficeAndJobs(
          ns,
          CORP_CONFIG.divisions.chem.name,
          city,
          6,
          CORP_CONFIG.jobDistribution.chem6,
        );
      }
    },
  }),

  INIT_TOBACCO: new InitTobaccoPhaseHandler(),
  TOBACCO_LOOP: new TobaccoLoopPhaseHandler(),
};

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();

  const corp = ns.corporation;
  let currentPhase: CorpPhase = "INIT_AGRI";
  const recentLogs: string[] = [];

  const log = (msg: string) => {
    ns.print(msg);
    recentLogs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (recentLogs.length > 5) recentLogs.shift();
  };

  log(`[CORP] Manager gestartet. Starte Phase: ${currentPhase}`);

  while (true) {
    await corp.nextUpdate();

    // 1. Grund-Prüfung: Corporation gründen falls nicht vorhanden
    if (!corp.hasCorporation()) {
      if (corp.createCorporation(CORP_CONFIG.corpName, true)) {
        log(`[CORP] ${CORP_CONFIG.corpName} erfolgreich gegründet!`);
      } else {
        log("[CORP] Fehler bei Gründung (Zu wenig Kapital?)");
        continue;
      }
    }

    // 2. Aktuellen Phasen-Handler abrufen und ausführen
    // Explizite Typierung für handler und nextPhase hinzufügen:
    const handler: CorpPhaseHandler | undefined = handlers[currentPhase];

    if (handler) {
      const nextPhase: CorpPhase = await handler.execute({
        ns,
        log,
        currentPhase,
      });

      if (nextPhase !== currentPhase) {
        log(`[CORP] Phasenwechsel: ${currentPhase} ➔ ${nextPhase}`);
        currentPhase = nextPhase;
      }
    }

    // 3. Zustand für das Dashboard / UI synchronisieren
    const corpInfo = corp.getCorporation();
    patchCorporationState(ns, {
      hasCorp: true,
      corpName: corpInfo.name,
      funds: corpInfo.funds,
      revenue: corpInfo.revenue,
      expenses: corpInfo.expenses,
      divisions: corpInfo.divisions,
      stage: currentPhase,
      investmentOffer: corp.getInvestmentOffer().funds,
      corpRecentLogs: recentLogs,
    });
  }
}
