// domain/corporation/phases/phase-chem.ts

import {
  autoResearchDivision,
  buyCorporationUpgrades,
  calculateDivisionSetupCost,
  maintainEmployeeMorale,
  purchaseBoosterMaterials,
  safeExportMaterial,
  syncOfficeJobsWithResearch,
  upgradeWarehouseToLevel,
} from "../corporation-helpers";
import { CorpPhaseContext, CorpPhaseHandler } from "../types";
import {
  CORP_CONFIG,
  CorpPhase,
  AGRI_BOOST_RATIOS,
  CHEM_BOOST_RATIOS,
  MATERIAL_RESEARCH_PRIORITY,
} from "../../../shared/constants/corporation";

export class InitChemPhaseHandler implements CorpPhaseHandler {
  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log } = ctx;
    const corp = ns.corporation;
    const { chem } = CORP_CONFIG.divisions;

    log("Initialisiere Chemical-Division...", "INFO");

    // 1. Vorab-Kapitalprüfung für Gründung + alle Städte + alle Lagerhäuser
    if (!corp.getCorporation().divisions.includes(chem.name)) {
      const requiredCost = calculateDivisionSetupCost(ns, chem.type, {
        includeCities: true,
        includeWarehouses: true,
      });

      if (corp.getCorporation().funds < requiredCost) {
        log(
          `[CHEM] Warten auf Kapital für Chem-Setup ($${ns.format.number(requiredCost)})...`,
          "DEBUG",
        );
        return ctx.currentPhase;
      }

      corp.expandIndustry(chem.type, chem.name);
    }

    const hasSmartSupply = corp.hasUnlock("Smart Supply");

    // 2. Städte, Lagerhäuser, Jobs & Verkäufe einrichten
    for (const city of CORP_CONFIG.cities) {
      if (!corp.getDivision(chem.name).cities.includes(city)) {
        corp.expandCity(chem.name, city);
      }

      if (!corp.hasWarehouse(chem.name, city)) {
        corp.purchaseWarehouse(chem.name, city);
      }

      if (hasSmartSupply) {
        corp.setSmartSupply(chem.name, city, true);
        corp.setSmartSupplyOption(chem.name, city, "Plants", "leftovers");
        corp.setSmartSupplyOption(chem.name, city, "Water", "leftovers");
      }

      syncOfficeJobsWithResearch(ns, chem.name, city, 6, false);
      upgradeWarehouseToLevel(
        ns,
        chem.name,
        city,
        CORP_CONFIG.warehouseLevels.chemR1,
      );

      corp.sellMaterial(chem.name, city, "Chemicals", "MAX", "MP");
    }

    log(
      `Chem-Initialisierung abgeschlossen ${!hasSmartSupply ? "(ohne Smart Supply)" : ""}. Wechsle zu EXPORT_LOOP.`,
      "SUCCESS",
    );
    return "EXPORT_LOOP";
  }
}

export class ExportLoopPhaseHandler implements CorpPhaseHandler {
  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log, logger } = ctx;
    const corp = ns.corporation;
    const { agri, chem } = CORP_CONFIG.divisions;

    if (!corp.getCorporation().divisions.includes(chem.name)) {
      log(
        `[CHEM] Division '${chem.name}' existiert noch nicht. Kehre zu INIT_CHEM zurück...`,
        "WARN",
      );
      return "INIT_CHEM";
    }

    log("Führe Skalierung & Export-Loop für Investor 2 aus...", "DEBUG");

    const agriResearchedAll = autoResearchDivision(
      ns,
      agri.name,
      MATERIAL_RESEARCH_PRIORITY,
      log,
    );

    const chemResearchedAll = autoResearchDivision(
      ns,
      chem.name,
      MATERIAL_RESEARCH_PRIORITY,
      log,
    );
    let allReady = true;

    for (const city of CORP_CONFIG.cities) {
      safeExportMaterial(
        ns,
        chem.name,
        city,
        agri.name,
        city,
        "Chemicals",
        "IPROD * -1",
      );
      safeExportMaterial(
        ns,
        agri.name,
        city,
        chem.name,
        city,
        "Plants",
        "IPROD * -1",
      );

      syncOfficeJobsWithResearch(
        ns,
        agri.name,
        city,
        CORP_CONFIG.officeSizes.phase2,
        agriResearchedAll,
      );
      syncOfficeJobsWithResearch(
        ns,
        chem.name,
        city,
        CORP_CONFIG.officeSizes.phase2,
        chemResearchedAll,
      );

      upgradeWarehouseToLevel(
        ns,
        agri.name,
        city,
        CORP_CONFIG.warehouseLevels.agriR2,
      );
      upgradeWarehouseToLevel(
        ns,
        chem.name,
        city,
        CORP_CONFIG.warehouseLevels.chemR2,
      );

      const agriReady = await purchaseBoosterMaterials(
        ns,
        agri.name,
        city,
        AGRI_BOOST_RATIOS.R2,
      );
      const chemReady = await purchaseBoosterMaterials(
        ns,
        chem.name,
        city,
        CHEM_BOOST_RATIOS.R2,
      );

      maintainEmployeeMorale(ns, agri.name, city);
      maintainEmployeeMorale(ns, chem.name, city);

      if (!agriReady || !chemReady) {
        allReady = false;
      }
    }

    buyCorporationUpgrades(ns, 0.05, logger);

    if (allReady) {
      log("Vorbereitung abgeschlossen! Wechsle zu INVESTOR_2.", "SUCCESS");
      return "INVESTOR_2";
    }

    return ctx.currentPhase;
  }
}