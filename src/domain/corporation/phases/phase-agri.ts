import {
  CorpPhase,
  CORP_CONFIG,
  AGRI_BOOST_RATIOS,
} from "../../../shared/constants/corporation";
import {
  calculateDivisionSetupCost,
  setupOfficeAndJobs,
  upgradeWarehouseToLevel,
  purchaseBoosterMaterials,
  maintainEmployeeMorale,
} from "../corporation-helpers";
import { CorpPhaseContext, CorpPhaseHandler } from "../types";

export class InitAgriPhaseHandler implements CorpPhaseHandler {
  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log } = ctx;
    const corp = ns.corporation;
    const { agri } = CORP_CONFIG.divisions;

    log("Initialisiere Agri-Sparte...", "INFO");

    const isExpanded = corp.getCorporation().divisions.includes(agri.name);

    // 1. Kapital-Prüfung vorab (Gründung + alle Städte + alle Lagerhäuser)
    if (!isExpanded) {
      const requiredSetupCost = calculateDivisionSetupCost(ns, agri.type, {
        includeCities: true,
        includeWarehouses: true,
      });

      if (corp.getCorporation().funds < requiredSetupCost) {
        log(
          `Warten auf Kapital für Agri-Setup ($${ns.format.number(requiredSetupCost)})...`,
          "DEBUG",
        );
        return ctx.currentPhase;
      }

      corp.expandIndustry(agri.type, agri.name);
    }

    const hasSmartSupply = corp.hasUnlock("Smart Supply");

    // 2. Städte & Lagerhäuser direkt in einem Rutsch durchkonfigurieren
    for (const city of CORP_CONFIG.cities) {
      if (!corp.getDivision(agri.name).cities.includes(city)) {
        corp.expandCity(agri.name, city);
      }
      if (!corp.hasWarehouse(agri.name, city)) {
        corp.purchaseWarehouse(agri.name, city);
      }

      if (hasSmartSupply) {
        corp.setSmartSupply(agri.name, city, true);
        corp.setSmartSupplyOption(agri.name, city, "Water", "leftovers");
        corp.setSmartSupplyOption(agri.name, city, "Chemicals", "leftovers");
      }

      corp.sellMaterial(agri.name, city, "Plants", "MAX", "MP");
      corp.sellMaterial(agri.name, city, "Food", "MAX", "MP");
    }

    log(
      `Agri-Initialisierung abgeschlossen ${!hasSmartSupply ? "(ohne Smart Supply)" : ""}. Wechsle zu AGRI_BOOST.`,
      "SUCCESS",
    );
    return "AGRI_BOOST";
  }
}

export class AgriBoostPhaseHandler implements CorpPhaseHandler {
  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log } = ctx;
    const { agri } = CORP_CONFIG.divisions;
    let allCitiesReady = true;

    for (const city of CORP_CONFIG.cities) {
      setupOfficeAndJobs(
        ns,
        agri.name,
        city,
        6,
        CORP_CONFIG.jobDistribution.support6,
      );

      upgradeWarehouseToLevel(
        ns,
        agri.name,
        city,
        CORP_CONFIG.warehouseLevels.agriR1,
      );

      // Dynamischer Einkauf basierend auf R1 Ratios
      const ready = await purchaseBoosterMaterials(
        ns,
        agri.name,
        city,
        AGRI_BOOST_RATIOS.R1,
      );

      maintainEmployeeMorale(ns, agri.name, city);

      if (!ready) {
        allCitiesReady = false;
      }
    }

    if (allCitiesReady) {
      log("AGRI_BOOST abgeschlossen! Alle Lagerhäuser sind bereit.", "SUCCESS");
      return "INVESTOR_1";
    }

    return ctx.currentPhase;
  }
}