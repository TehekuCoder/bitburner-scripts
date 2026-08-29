import { CityName, CorpMaterialName, NS } from "@ns";
import { AGRI_BOOST_RATIOS, CHEM_BOOST_RATIOS, CORP_CONFIG, CorpPhase } from "../../shared/constants/corporation";
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
  const offer = corp.getInvestmentOffer();
  const currentRound = offer ? offer.round : 1;

  const agriName = CORP_CONFIG.divisions.agri.name;
  const chemName = CORP_CONFIG.divisions.chem.name;
  const tobaccoName = CORP_CONFIG.divisions.tobacco.name;

  // 1. Investor 1 noch offen (Round 1)
  if (currentRound === 1) {
    if (!existingDivs.includes(agriName)) return "INIT_AGRI";
    const agriWarehouseReady = CORP_CONFIG.cities.every(
      (c) =>
        corp.hasWarehouse(agriName, c) &&
        corp.getWarehouse(agriName, c).level >= CORP_CONFIG.warehouseLevels.agriR1,
    );
    const hasHardware = corp.getMaterial(agriName, CORP_CONFIG.cities[0], "Hardware").stored >= 125;
    return agriWarehouseReady && hasHardware ? "INVESTOR_1" : "AGRI_BOOST";
  }

  // 2. Investor 2 noch offen (Round 2)
  if (currentRound === 2 && postInvestor1Phase !== "INIT_TOBACCO") {
    if (!existingDivs.includes(chemName)) return "INIT_CHEM";

    const hasAllChemCities = CORP_CONFIG.cities.every(
      (c) => chemDivHasWarehouse(corp, chemName, c),
    );
    if (!hasAllChemCities) return "INIT_CHEM";

    const agriR2Ready = CORP_CONFIG.cities.every(
      (c) => corp.getWarehouse(agriName, c).level >= CORP_CONFIG.warehouseLevels.agriR2,
    );
    const chemR2Ready = CORP_CONFIG.cities.every(
      (c) => corp.getWarehouse(chemName, c).level >= CORP_CONFIG.warehouseLevels.chemR2,
    );

    return agriR2Ready && chemR2Ready ? "INVESTOR_2" : "EXPORT_LOOP";
  }

  // 3. Nach Investor 2 / Round >= 3 -> Tobacco Phase
  if (!existingDivs.includes(tobaccoName)) return "INIT_TOBACCO";

  const tobDiv = corp.getDivision(tobaccoName);
  const hasAllCities = CORP_CONFIG.cities.every((c) => tobDiv.cities.includes(c));
  const mainOfficeSize = tobDiv.cities.includes(CORP_CONFIG.mainCity)
    ? corp.getOffice(tobaccoName, CORP_CONFIG.mainCity).size
    : 0;

  return hasAllCities && mainOfficeSize >= 60 ? "TOBACCO_LOOP" : "INIT_TOBACCO";
}

function chemDivHasWarehouse(corp: any, chemName: string, city: CityName): boolean {
  return corp.getDivision(chemName).cities.includes(city) && corp.hasWarehouse(chemName, city);
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

function hasBoosterMaterials(
  ns: NS,
  divName: string,
  targets: Partial<Record<CorpMaterialName, number>>
): boolean {
  const corp = ns.corporation;
  if (!corp.getCorporation().divisions.includes(divName)) return false;

  for (const city of CORP_CONFIG.cities) {
    if (!corp.hasWarehouse(divName, city)) return false;
    
    for (const [matName, targetQty] of Object.entries(targets)) {
      if (targetQty && targetQty > 0) {
        const stored = corp.getMaterial(divName, city, matName as CorpMaterialName).stored;
        // Mindestens 95% des Ziels müssen vorhanden sein
        if (stored < targetQty * 0.95) {
          return false;
        }
      }
    }
  }
  return true;
}