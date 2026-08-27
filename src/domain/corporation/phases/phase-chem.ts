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

    log(
      "Richte bidirektionale Export-Routen ein (Chemicals <-> Plants)...",
      "DEBUG",
    );

    for (const city of CORP_CONFIG.cities) {
      // Chemikalien an Agriculture liefern (verbessert dort die Pflanzenproduktion)
      safeExportMaterial(
        ns,
        chem.name,
        city,
        agri.name,
        city,
        "Chemicals",
        "IPROD * -1",
      );

      // Pflanzen an Chemical liefern (wird als Rohstoff für Chemikalien benötigt)
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
