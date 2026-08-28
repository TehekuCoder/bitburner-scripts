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
import { LoggerClient } from "/infrastructure/logging/logger-client";
import { LogLevel } from "/shared/types/logger";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail(); // Bitburner v3 Standard für Tail-Fenster

  const logger = new LoggerClient(ns, "CORP");
  const corp = ns.corporation;
  const bnMults = loadBnMults(ns);

  // Multiplikatoren & Limits (Bitburner v2 / v3 kompatibel)
  const divMult = bnMults.CorporationDivisions ?? 1.0;
  const valMult = bnMults.CorporationValuation ?? 1.0;
  const maxAllowedDivisions = Math.max(1, Math.floor(20 * divMult));

  // Wenn weniger als 3 Divisionen erlaubt sind, skippen wir Chem und gehen direkt zu Tobacco
  const postInvestor1Phase: CorpPhase =
    maxAllowedDivisions >= 3 ? "INIT_CHEM" : "INIT_TOBACCO";

  // Phasen-Bestimmung anhand des echten Spielzustands
  let currentPhase = determinePhase(ns, postInvestor1Phase);

  const recentLogs: string[] = [];
  const log = (msg: string, level: LogLevel = "INFO") => {
    const logMethod =
      (logger[level.toLowerCase() as keyof LoggerClient] as Function) ??
      logger.info;
    logMethod.call(logger, msg);

    recentLogs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (recentLogs.length > 5) recentLogs.shift();
  };

  log(
    `Start in Phase: ${currentPhase} | Max. erlaubte Divisionen: ${maxAllowedDivisions} | Valuation Mult: ${valMult.toFixed(2)}x`,
  );

  // Dynamische Investor-Ziele basierend auf BN-Valuation-Multiplikator
  const inv1Target = Math.max(20_000_000_000, 200_000_000_000 * valMult);
  const inv2Target = Math.max(200_000_000_000, 2_000_000_000_000 * valMult);

  const handlers: Record<string, CorpPhaseHandler> = {
    INIT_AGRI: new InitAgriPhaseHandler(),
    AGRI_BOOST: new AgriBoostPhaseHandler(),
    INVESTOR_1: new InvestorPhaseHandler({
      divisionNames: [CORP_CONFIG.divisions.agri.name],
      targetOffer: inv1Target,
      nextPhase: postInvestor1Phase,
      resetJobs: (ns: NS) =>
        resetDivisionJobs(
          ns,
          CORP_CONFIG.divisions.agri.name,
          CORP_CONFIG.officeSizes.phase1,
          CORP_CONFIG.jobDistribution.support6,
        ),
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
      resetJobs: (ns: NS) => {
        resetDivisionJobs(
          ns,
          CORP_CONFIG.divisions.agri.name,
          CORP_CONFIG.officeSizes.phase2,
          CORP_CONFIG.jobDistribution.support9,
        );
        resetDivisionJobs(
          ns,
          CORP_CONFIG.divisions.chem.name,
          CORP_CONFIG.officeSizes.phase2,
          CORP_CONFIG.jobDistribution.chem9,
        );
      },
    }),
    INIT_TOBACCO: new InitTobaccoPhaseHandler(),
    TOBACCO_LOOP: new TobaccoLoopPhaseHandler(),
  };

  while (true) {
    await corp.nextUpdate();

    // 1. Corporation gründen, falls noch nicht geschehen
    if (!corp.hasCorporation()) {
      if (!corp.createCorporation(CORP_CONFIG.corpName, true)) {
        log("[CORP] Warten auf Kapital für Gründung...");
        continue;
      }
    }

    // 2. Automatisches Kaufen wichtiger Unlocks je nach Phase (z.B. Smart Supply)
    buyPhaseUnlocks(ns, currentPhase);

    // 3. Phasen-Handler ausführen
    const handler = handlers[currentPhase];
    if (handler) {
      const nextPhase = await handler.execute({
        ns,
        logger,
        log,
        currentPhase,
      });

      if (nextPhase && nextPhase !== currentPhase) {
        log(`[CORP] Phasenwechsel: ${currentPhase} ➔ ${nextPhase}`);
        currentPhase = nextPhase;
      }
    } else {
      log(
        `[WARN] Unbekannte Phase '${currentPhase}'! Erzwinge Neu-Ermittlung...`,
        "WARN",
      );
      currentPhase = determinePhase(ns, postInvestor1Phase, true);
    }

    // 4. State persistent aktualisieren
    const corpInfo = corp.getCorporation();
    const offer = corp.getInvestmentOffer();

    patchCorporationState(ns, {
      hasCorp: true,
      corpName: corpInfo.name,
      funds: corpInfo.funds,
      revenue: corpInfo.revenue,
      expenses: corpInfo.expenses,
      divisions: corpInfo.divisions,
      stage: currentPhase,
      investmentOffer: offer ? offer.funds : 0,
      corpRecentLogs: recentLogs,
    });
  }
}

/** Ermittelt die Phase valide anhand des echten Bitburner-Konzernzustands */
function determinePhase(
  ns: NS,
  postInvestor1Phase: CorpPhase,
  forceReevaluate = false,
): CorpPhase {
  const savedState = loadCorporationState(ns);
  const savedStage = savedState?.stage as CorpPhase | undefined;

  if (
    !forceReevaluate &&
    savedStage &&
    savedStage !== ("INACTIVE" as CorpPhase)
  ) {
    return savedStage;
  }

  const corp = ns.corporation;
  if (!corp.hasCorporation()) return "INIT_AGRI";

  const existingDivs = corp.getCorporation().divisions;
  // Null-Safety für das Investment-Angebot
  const offer = corp.getInvestmentOffer();
  const currentRound = offer ? offer.round : 1;

  // 1. Tabak-Sparte existiert bereits
  if (existingDivs.includes(CORP_CONFIG.divisions.tobacco.name)) {
    const tobDiv = corp.getDivision(CORP_CONFIG.divisions.tobacco.name);
    const hasAllCities = CORP_CONFIG.cities.every((c) =>
      tobDiv.cities.includes(c),
    );
    const mainOfficeSize = tobDiv.cities.includes(CORP_CONFIG.mainCity)
      ? corp.getOffice(CORP_CONFIG.divisions.tobacco.name, CORP_CONFIG.mainCity)
          .size
      : 0;

    return hasAllCities && mainOfficeSize >= 60
      ? "TOBACCO_LOOP"
      : "INIT_TOBACCO";
  }

  // 2. Investor 1 wurde bereits kassiert (round >= 2)
  if (currentRound >= 2) {
    if (postInvestor1Phase === "INIT_TOBACCO" || currentRound > 2) {
      return "INIT_TOBACCO";
    }

    if (!existingDivs.includes(CORP_CONFIG.divisions.chem.name)) {
      return "INIT_CHEM";
    }

    const chemDiv = corp.getDivision(CORP_CONFIG.divisions.chem.name);
    const isFullyExpanded = CORP_CONFIG.cities.every((c) =>
      chemDiv.cities.includes(c),
    );

    return isFullyExpanded ? "EXPORT_LOOP" : "INIT_CHEM";
  }

  // 3. Agrar-Sparte existiert (Investor 1 noch nicht angenommen -> round === 1)
  if (existingDivs.includes(CORP_CONFIG.divisions.agri.name)) {
    const agriDiv = corp.getDivision(CORP_CONFIG.divisions.agri.name);
    const hasAllCities = CORP_CONFIG.cities.every((c) =>
      agriDiv.cities.includes(c),
    );

    if (!hasAllCities) return "INIT_AGRI";

    const firstCity = CORP_CONFIG.cities[0];
    const hasHardware =
      corp.getMaterial(agriDiv.name, firstCity, "Hardware").stored >= 125;

    return hasHardware ? "INVESTOR_1" : "AGRI_BOOST";
  }

  return "INIT_AGRI";
}

/** Hilfsfunktion zum Setzen von Jobs in allen Städten einer Division */
function resetDivisionJobs(
  ns: NS,
  divName: string,
  officeSize: number,
  jobs: Record<string, number>,
): void {
  for (const city of CORP_CONFIG.cities) {
    setupOfficeAndJobs(ns, divName, city, officeSize, jobs);
  }
}
