import {
  buyCorporationUpgrades,
  maintainEmployeeMorale,
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

      corp.setSmartSupply(chem.name, city, true);
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

    log("Richte Export-Routen mit IPROD * -1 ein...", "DEBUG");

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

      maintainEmployeeMorale(ns, agri.name, city);
      maintainEmployeeMorale(ns, chem.name, city);
    }

    buyCorporationUpgrades(ns, 0.05, logger);

    log("Export-Loop aktiv! Wechsle zu INVESTOR_2.", "SUCCESS");
    return "INVESTOR_2";
  }
}
