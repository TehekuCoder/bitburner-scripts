import { CorpPhase, CORP_CONFIG } from "../../../shared/constants/corporation";
import {
  setupOfficeAndJobs,
  upgradeWarehouseToLevel,
  purchaseBoosterMaterials,
  maintainEmployeeMorale,
} from "../corporation-helpers";
import { CorpPhaseContext, CorpPhaseHandler } from "../types";

/**
 * Phase 1: Erstellt die Agri-Sparte, baut Lagerhäuser in allen Städten auf
 * und aktiviert Smart Supply sowie den Verkauf.
 */
export class InitAgriPhaseHandler implements CorpPhaseHandler {
  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log } = ctx;
    const corp = ns.corporation;
    const { agri } = CORP_CONFIG.divisions;

    log("[CORP] Initialisiere Agri-Sparte...");

    if (!corp.getCorporation().divisions.includes(agri.name)) {
      corp.expandIndustry(agri.type, agri.name);
    }

    for (const city of CORP_CONFIG.cities) {
      if (!corp.getDivision(agri.name).cities.includes(city)) {
        corp.expandCity(agri.name, city);
      }
      if (!corp.hasWarehouse(agri.name, city)) {
        corp.purchaseWarehouse(agri.name, city);
      }

      corp.setSmartSupply(agri.name, city, true);
      corp.setSmartSupplyOption(agri.name, city, "Water", "leftovers");
      corp.setSmartSupplyOption(agri.name, city, "Chemicals", "leftovers");

      corp.sellMaterial(agri.name, city, "Plants", "MAX", "MP");
      corp.sellMaterial(agri.name, city, "Food", "MAX", "MP");
    }

    log("[CORP] Agri-Initialisierung abgeschlossen. Wechsle zu AGRI_BOOST.");
    return "AGRI_BOOST";
  }
}

/**
 * Phase 2: Rüstet Büros/Lager aus und kauft Booster-Materialien,
 * bis der Zielbestand für die erste Investorenrunde erreicht ist.
 */
export class AgriBoostPhaseHandler implements CorpPhaseHandler {
  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log } = ctx;
    const { agri } = CORP_CONFIG.divisions;
    let allCitiesReady = true;

    for (const city of CORP_CONFIG.cities) {
      // 1. Büro und Mitarbeiter einrichten
      setupOfficeAndJobs(
        ns,
        agri.name,
        city,
        6,
        CORP_CONFIG.jobDistribution.support6,
      );

      // 2. Lagerhaus hochstufen
      upgradeWarehouseToLevel(ns, agri.name, city, 3);

      // 3. Booster-Materialien schrittweise einkaufen
      const ready = await purchaseBoosterMaterials(
        ns,
        agri.name,
        city,
        CORP_CONFIG.agriBoosterR1,
      );

      // 4. Moral und Energie sichern
      maintainEmployeeMorale(ns, agri.name, city);

      if (!ready) {
        allCitiesReady = false;
      }
    }

    if (allCitiesReady) {
      log("[CORP] AGRI_BOOST abgeschlossen! Alle Lagerhäuser sind bereit.");
      return "INVESTOR_1";
    }

    return ctx.currentPhase; // Bleibt in AGRI_BOOST, bis alle Materialien gekauft sind
  }
}