import {
  buyCorporationUpgrades,
  maintainEmployeeMorale,
  purchaseBoosterMaterials,
  safeExportMaterial,
  setupOfficeAndJobs,
  upgradeWarehouseToLevel,
} from "../corporation-helpers";
import { CorpPhaseContext, CorpPhaseHandler } from "../types";
import { CORP_CONFIG, CorpPhase } from "/shared/constants/corporation";

export class InitChemPhaseHandler implements CorpPhaseHandler {
  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log } = ctx;
    const corp = ns.corporation;
    const { chem } = CORP_CONFIG.divisions;

    log("Gründe Chemical-Division...", "INFO");

    if (!corp.getCorporation().divisions.includes(chem.name)) {
      corp.expandIndustry(chem.type, chem.name);
    }

    for (const city of CORP_CONFIG.cities) {
      if (!corp.getDivision(chem.name).cities.includes(city)) {
        corp.expandCity(chem.name, city);
      }
      if (!corp.hasWarehouse(chem.name, city)) {
        corp.purchaseWarehouse(chem.name, city);
      }

      // Smart Supply aktivieren für den automatisieren Einkauf der Rohstoffe (Plants & Water)
      corp.setSmartSupply(chem.name, city, true);

      // "leftovers": Kauft nur Pflanzen/Wasser nach, wenn Exporte nicht reichen
      corp.setSmartSupplyOption(chem.name, city, "Plants", "leftovers");
      corp.setSmartSupplyOption(chem.name, city, "Water", "leftovers");

      setupOfficeAndJobs(
        ns,
        chem.name,
        city,
        6,
        CORP_CONFIG.jobDistribution.chem6,
      );
      upgradeWarehouseToLevel(ns, chem.name, city, 3);

      // Verkaufe das hergestellte Hauptprodukt: Chemicals
      corp.sellMaterial(chem.name, city, "Chemicals", "MAX", "MP");
    }

    log(
      "Chem-Initialisierung abgeschlossen. Wechsle zu EXPORT_LOOP",
      "SUCCESS",
    );
    return "EXPORT_LOOP";
  }
}

export class ExportLoopPhaseHandler implements CorpPhaseHandler {
  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log, logger } = ctx;
    const { agri, chem } = CORP_CONFIG.divisions;

    log("Führe Skalierung & Export-Loop für Investor 2 aus...", "DEBUG");

    let allReady = true;

    for (const city of CORP_CONFIG.cities) {
      // 1. Export-Routen sicherstellen
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

      // 2. Büros auf 9 Mitarbeiter aufstocken
      const agriOffice = setupOfficeAndJobs(
        ns,
        agri.name,
        city,
        CORP_CONFIG.officeSizes.phase2,
        CORP_CONFIG.jobDistribution.support9,
      );
      const chemOffice = setupOfficeAndJobs(
        ns,
        chem.name,
        city,
        CORP_CONFIG.officeSizes.phase2,
        CORP_CONFIG.jobDistribution.chem9,
      );

      // 3. Lagerhäuser ausbauen
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

      // 4. Booster-Materialien für R2 aufkaufen
      const agriReady = await purchaseBoosterMaterials(
        ns,
        agri.name,
        city,
        CORP_CONFIG.AGRI_BOOST_R2,
      );
      const chemReady = await purchaseBoosterMaterials(
        ns,
        chem.name,
        city,
        CORP_CONFIG.CHEM_BOOST_R2,
      );

      maintainEmployeeMorale(ns, agri.name, city);
      maintainEmployeeMorale(ns, chem.name, city);

      if (!agriOffice || !chemOffice || !agriReady || !chemReady) {
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
