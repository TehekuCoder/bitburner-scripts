import {
  buyCorporationUpgrades,
  maintainEmployeeMorale,
  safeExportMaterial,
  setupOfficeAndJobs,
  upgradeWarehouseToLevel,
} from "../corporation-helpers";
import { CorpPhaseContext, CorpPhaseHandler } from "../types";
import {
  CORP_CONFIG,
  CORP_RESEARCH_PRIORITY,
  CorpPhase,
} from "/shared/constants/corporation";

export class InitTobaccoPhaseHandler implements CorpPhaseHandler {
  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log } = ctx;
    const corp = ns.corporation;
    const { tobacco, agri } = CORP_CONFIG.divisions;

    log("[CORP] Gründe Tobacco-Division...");
    if (!corp.getCorporation().divisions.includes(tobacco.name)) {
      corp.expandIndustry(tobacco.type, tobacco.name);
    }

    for (const city of CORP_CONFIG.cities) {
      if (!corp.getDivision(tobacco.name).cities.includes(city)) {
        corp.expandCity(tobacco.name, city);
      }
      if (!corp.hasWarehouse(tobacco.name, city)) {
        corp.purchaseWarehouse(tobacco.name, city);
      }

      corp.setSmartSupply(tobacco.name, city, true);
      upgradeWarehouseToLevel(ns, tobacco.name, city, 10);

      safeExportMaterial(
        ns,
        agri.name,
        city,
        tobacco.name,
        city,
        "Plants",
        "IPROD * -1",
      );

      if (city === CORP_CONFIG.mainCity) {
        setupOfficeAndJobs(
          ns,
          tobacco.name,
          city,
          60,
          CORP_CONFIG.jobDistribution.tobaccoHQ60,
        );
      } else {
        setupOfficeAndJobs(ns, tobacco.name, city, 12, {
          "Research & Development": 12,
        });
      }
    }
    log(
      "[CORP] Tobacco-Initialisierung abgeschlossen. Wechsle zu TOBACCO_LOOP",
    );
    return "TOBACCO_LOOP";
  }
}

export class TobaccoLoopPhaseHandler implements CorpPhaseHandler {
  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log } = ctx;
    const corp = ns.corporation;
    const { tobacco } = CORP_CONFIG.divisions;
    const mainCity = CORP_CONFIG.mainCity;

    // A. Moral & Energie auf 100% halten
    for (const city of CORP_CONFIG.cities) {
      maintainEmployeeMorale(ns, tobacco.name, city);
    }

    // B. Forschungs-Manager
    for (const tech of CORP_RESEARCH_PRIORITY) {
      if (!corp.hasResearched(tobacco.name, tech)) {
        const cost = corp.getResearchCost(tobacco.name, tech);
        if (corp.getDivision(tobacco.name).researchPoints >= cost) {
          try {
            corp.research(tobacco.name, tech);
            log(`[CORP] Erforscht: ${tech}`);
          } catch {
            // Ignoriere fehlende Prerequisites
          }
        }
      }
    }

    // C. Produkt-Lifecycle & Automatische Erstellung
    const divInfo = corp.getDivision(tobacco.name);
    const products = divInfo.products;
    const hasTA2 = corp.hasResearched(tobacco.name, "Market-TA.II");

    // 1. Fertige Produkte zum Verkauf freigeben
    for (const prodName of products) {
      const prod = corp.getProduct(tobacco.name, mainCity, prodName);
      if (prod.developmentProgress === 100) {
        // sellProduct IMMER aufrufen, um Menge (MAX) und Basis-Preis zu definieren
        const price = hasTA2 ? "MP" : "MP * 2";
        corp.sellProduct(
          tobacco.name,
          mainCity,
          prodName,
          "MAX",
          price,
          true,
        );

        if (hasTA2) {
          corp.setProductMarketTA2(tobacco.name, prodName, true);
        }
      }
    }

    // 2. Prüfen, ob aktuell noch ein Produkt entwickelt wird (< 100%)
    const isDeveloping = products.some(
      (p) =>
        corp.getProduct(tobacco.name, mainCity, p).developmentProgress < 100,
    );

    // 3. Maximale Anzahl an gleichzeitigen Produkten ermitteln
    let maxProducts = 3;
    if (corp.hasResearched(tobacco.name, "uPgrade: Capacity.I")) maxProducts++;
    if (corp.hasResearched(tobacco.name, "uPgrade: Capacity.II")) maxProducts++;

    // 4. Neues Produkt starten, wenn aktuell keins in Entwicklung ist
    if (!isDeveloping) {
      // Wenn Slot-Limit erreicht ist, ältestes Produkt einstellen
      if (products.length >= maxProducts) {
        const oldestProduct = products[0];
        corp.discontinueProduct(tobacco.name, oldestProduct);
        log(`[CORP] Ältestes Produkt ${oldestProduct} eingestellt.`);

        const idx = products.indexOf(oldestProduct);
        if (idx !== -1) products.splice(idx, 1);
      }

      // Generischen, nächsten freien Namen ermitteln (Tobacco-1, Tobacco-2, ...)
      let prodIndex = 1;
      while (products.includes(`Tobacco-${prodIndex}`)) {
        prodIndex++;
      }
      const newProdName = `Tobacco-${prodIndex}`;

      // Budget festlegen
      const availableFunds = corp.getCorporation().funds;
      const totalInvestment = Math.min(
        1_000_000_000,
        Math.max(2_000_000, availableFunds * 0.1),
      );

      if (totalInvestment >= 2_000_000) {
        const halfInvestment = totalInvestment / 2;

        corp.makeProduct(
          tobacco.name,
          mainCity,
          newProdName,
          halfInvestment,
          halfInvestment,
        );
        log(
          `[CORP] Neues Produkt gestartet: ${newProdName} (Budget: ${ns.format.number(totalInvestment)} $)`,
        );
      }
    }

    // D. Upgrades & Marketing Skalierung
    if (corp.getCorporation().funds > 1_000_000_000) {
      buyCorporationUpgrades(ns, 0.1);

      const wilsonCost = corp.getUpgradeLevelCost("Wilson Analytics");
      if (corp.getCorporation().funds >= wilsonCost) {
        corp.levelUpgrade("Wilson Analytics");
        log(
          `[CORP] Wilson Analytics auf Lvl ${corp.getUpgradeLevel("Wilson Analytics")} erhöht!`,
        );
      } else {
        const advertCost = corp.getHireAdVertCost(tobacco.name);
        if (corp.getCorporation().funds >= advertCost * 2) {
          corp.hireAdVert(tobacco.name);
        }
      }
    }

    // E. IPO & Dividenden
    const corpData = corp.getCorporation();
    if (!corpData.public) {
      if (corpData.revenue > 100_000_000_000) {
        corp.goPublic(0);
        log("[CORP] ** PHILIP MATRIX IST AN DIE BÖRSE GEGANGEN! **");
      }
    } else {
      corp.issueDividends(0.5);
    }

    return "TOBACCO_LOOP";
  }
}