import { NS } from "@ns";
import { CORP_CONFIG, CorpPhase } from "../../shared/constants/corporation";
import {
  patchCorporationState,
  loadCorporationState,
} from "../../infrastructure/state/state";
import {
  setupOfficeAndJobs,
  buyPhaseUnlocks,
} from "../../domain/corporation/corporation-helpers";
import { CorpPhaseHandler } from "../../domain/corporation/types";
import { loadBnMults } from "/lib/utils.js";

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

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();

  const corp = ns.corporation;
  const bnMults = loadBnMults(ns);

  // Multiplikatoren berechnen
  const divMult = bnMults.CorporationDivisions ?? 1.0;
  const valMult = bnMults.CorporationValuation ?? 1.0;
  const maxAllowedDivisions = Math.max(1, Math.floor(20 * divMult));

  // Dynamisches Next-Phase Routing basierend auf Sparten-Limits
  const postInvestor1Phase: CorpPhase =
    maxAllowedDivisions >= 3 ? "INIT_CHEM" : "INIT_TOBACCO";

  // Phasen-Wiederherstellung bei Skript-Neustart
  const savedState = loadCorporationState(ns);
  let currentPhase: CorpPhase = (savedState?.stage as CorpPhase) ?? "INIT_AGRI";

  if (corp.hasCorporation()) {
    const corpInfo = corp.getCorporation();
    const existingDivs = corpInfo.divisions;
    const currentRound = corp.getInvestmentOffer().round;

    if (existingDivs.includes(CORP_CONFIG.divisions.tobacco.name)) {
      const tobDiv = corp.getDivision(CORP_CONFIG.divisions.tobacco.name);
      const isFullyExpanded = CORP_CONFIG.cities.every((c) =>
        tobDiv.cities.includes(c),
      );
      currentPhase = isFullyExpanded ? "TOBACCO_LOOP" : "INIT_TOBACCO";
    } else if (existingDivs.includes(CORP_CONFIG.divisions.chem.name)) {
      const chemDiv = corp.getDivision(CORP_CONFIG.divisions.chem.name);
      const isFullyExpanded = CORP_CONFIG.cities.every((c) =>
        chemDiv.cities.includes(c),
      );
      if (currentRound > 2) {
        currentPhase = "INIT_TOBACCO";
      } else {
        currentPhase = isFullyExpanded ? "EXPORT_LOOP" : "INIT_CHEM";
      }
    } else if (existingDivs.includes(CORP_CONFIG.divisions.agri.name)) {
      if (currentRound > 1) {
        currentPhase = postInvestor1Phase;
      }
    }
  }

  const recentLogs: string[] = [];
  const log = (msg: string) => {
    ns.print(msg);
    recentLogs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (recentLogs.length > 5) recentLogs.shift();
  };

  log(
    `[CORP] Start in Phase: ${currentPhase} | Max. erlaubte Divisionen: ${maxAllowedDivisions} | Valuation Mult: ${valMult.toFixed(2)}x`,
  );

  // Dynamische Skalierung der Investor-Ziele
  const inv1Target = Math.max(20_000_000_000, 200_000_000_000 * valMult);
  const inv2Target = Math.max(200_000_000_000, 2_000_000_000_000 * valMult);

  const handlers: Record<CorpPhase, CorpPhaseHandler> = {
    INIT_AGRI: new InitAgriPhaseHandler(),
    AGRI_BOOST: new AgriBoostPhaseHandler(),

    INVESTOR_1: new InvestorPhaseHandler({
      divisionNames: [CORP_CONFIG.divisions.agri.name],
      targetOffer: inv1Target,
      nextPhase: postInvestor1Phase,
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
      targetOffer: inv2Target,
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

  while (true) {
    await corp.nextUpdate();

    if (!corp.hasCorporation()) {
      if (!corp.createCorporation(CORP_CONFIG.corpName, true)) {
        log("[CORP] Warten auf Kapital für Gründung...");
        continue;
      }
    }

    buyPhaseUnlocks(ns, currentPhase);

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