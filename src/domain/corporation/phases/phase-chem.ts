// domain/corporation/phases/phase-chem.ts

import {
  autoResearchDivision,
  buyCorporationUpgrades,
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

    log("Gründe Chemical-Division...", "INFO");

    if (!corp.getCorporation().divisions.includes(chem.name)) {
      const expandCost = 20_000_000_000; // $20b Kosten für Chemical Industry
      if (corp.getCorporation().funds < expandCost) {
        log(`[CHEM] Warten auf Kapital für Chem-Expansion ($20b)...`, "WARN");
        return "INIT_CHEM";
      }
      corp.expandIndustry(chem.type, chem.name);
    }

    const hasSmartSupply = corp.hasUnlock("Smart Supply");

    for (const city of CORP_CONFIG.cities) {
      if (!corp.getDivision(chem.name).cities.includes(city)) {
        const cityCost = 5_000_000;
        if (corp.getCorporation().funds < cityCost) return "INIT_CHEM";
        corp.expandCity(chem.name, city);
      }

      if (!corp.hasWarehouse(chem.name, city)) {
        const whCost = 5_000_000;
        if (corp.getCorporation().funds < whCost) return "INIT_CHEM";
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
      `Chem-Initialisierung abgeschlossen ${!hasSmartSupply ? "(ohne Smart Supply)" : ""}. Wechsle zu EXPORT_LOOP`,
      "SUCCESS",
    );
    return "EXPORT_LOOP";
  }
}

export class ExportLoopPhaseHandler implements CorpPhaseHandler {
  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log, logger } = ctx;
    const corp = ns.corporation; // <-- Gefixt: corp Variable definiert
    const { agri, chem } = CORP_CONFIG.divisions;

    log("Führe Skalierung & Export-Loop für Investor 2 aus...", "DEBUG");

    // 1. Automatische Forschung für Material-Sparten ausführen
    const agriResearchedAll = autoResearchDivision(
      ns,
      agri.name,
      MATERIAL_RESEARCH_PRIORITY,
      log
    );

    const chemResearchedAll = autoResearchDivision(
      ns,
      chem.name,
      MATERIAL_RESEARCH_PRIORITY,
      log
    );

    let allReady = true;

    for (const city of CORP_CONFIG.cities) {
      // Export-Routen sicherstellen
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

      // Büros auf Phase 2 vergrößern & Jobs inklusive R&D synchronisieren
      syncOfficeJobsWithResearch(
        ns,
        agri.name,
        city,
        CORP_CONFIG.officeSizes.phase2,
        agriResearchedAll
      );
      syncOfficeJobsWithResearch(
        ns,
        chem.name,
        city,
        CORP_CONFIG.officeSizes.phase2,
        chemResearchedAll
      );

      // Lagerhäuser ausbauen
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

      // Dynamischer Booster-Einkauf für R2
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