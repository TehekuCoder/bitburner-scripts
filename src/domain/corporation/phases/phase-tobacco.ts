import {
  buyCorporationUpgrades,
  maintainEmployeeMorale,
  maintainRatios,
  safeExportMaterial,
  setupOfficeAndJobs,
  upgradeWarehouseToLevel,
} from "../corporation-helpers";
import { CorpPhaseContext, CorpPhaseHandler } from "../types";
import {
  AGRI_BOOST_RATIOS,
  CHEM_BOOST_RATIOS,
  CORP_CONFIG,
  CORP_RESEARCH_PRIORITY,
  CorpPhase,
  TOBACCO_BOOST_RATIOS,
} from "/shared/constants/corporation";

export class InitTobaccoPhaseHandler implements CorpPhaseHandler {
  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log } = ctx;
    const corp = ns.corporation;
    const { tobacco, agri } = CORP_CONFIG.divisions;

    if (!corp.getCorporation().divisions.includes(tobacco.name)) {
      const requiredCost = 20_000_000_000;
      if (corp.getCorporation().funds < requiredCost) {
        log(
          `Warten auf Kapital für Tobacco-Gründung ($${ns.format.number(corp.getCorporation().funds, 2)} / $${ns.format.number(requiredCost, 2)})`,
          "DEBUG",
        );
        return ctx.currentPhase;
      }
      log("Gründe Tobacco-Division...", "INFO");
      corp.expandIndustry(tobacco.type, tobacco.name);
    }

    for (const city of CORP_CONFIG.cities) {
      if (!corp.getDivision(tobacco.name).cities.includes(city)) {
        const cityCost = 4_000_000_000;
        if (corp.getCorporation().funds < cityCost) {
          log(`Warten auf Kapital für Expansion nach ${city}...`, "DEBUG");
          return ctx.currentPhase;
        }
        corp.expandCity(tobacco.name, city);
      }
    }

    for (const city of CORP_CONFIG.cities) {
      if (!corp.hasWarehouse(tobacco.name, city)) {
        const whCost = 5_000_000_000;
        if (corp.getCorporation().funds < whCost) {
          log(`Warten auf Kapital für Lagerhalle in ${city}...`, "DEBUG");
          return ctx.currentPhase;
        }
        corp.purchaseWarehouse(tobacco.name, city);
      }

      if (corp.hasUnlock("Smart Supply")) {
        corp.setSmartSupply(tobacco.name, city, true);
      }

      upgradeWarehouseToLevel(ns, tobacco.name, city, 10);

      if (
        corp.getCorporation().divisions.includes(agri.name) &&
        corp.getDivision(agri.name).cities.includes(city)
      ) {
        safeExportMaterial(
          ns,
          agri.name,
          city,
          tobacco.name,
          city,
          "Plants",
          "IPROD * -1",
        );
      }

      const targetSize = city === CORP_CONFIG.mainCity ? 60 : 12;
      const currentOffice = corp.getOffice(tobacco.name, city);

      if (currentOffice.size < targetSize) {
        const upgradeCost = corp.getOfficeSizeUpgradeCost(
          tobacco.name,
          city,
          targetSize - currentOffice.size,
        );
        if (corp.getCorporation().funds < upgradeCost) {
          log(
            `Warten auf Kapital für Büro-Erweiterung in ${city} auf ${targetSize}...`,
            "DEBUG",
          );
          return ctx.currentPhase;
        }
        corp.upgradeOfficeSize(
          tobacco.name,
          city,
          targetSize - currentOffice.size,
        );
      }

      const jobSpec =
        city === CORP_CONFIG.mainCity
          ? CORP_CONFIG.jobDistribution.tobaccoHQ60
          : { "Research & Development": 12 };

      const setupSuccess = setupOfficeAndJobs(
        ns,
        tobacco.name,
        city,
        targetSize,
        jobSpec,
      );

      if (!setupSuccess) return ctx.currentPhase;
    }

    log(
      "Tobacco-Initialisierung abgeschlossen. Wechsle zu TOBACCO_LOOP.",
      "SUCCESS",
    );
    return "TOBACCO_LOOP";
  }
}

export class TobaccoLoopPhaseHandler implements CorpPhaseHandler {
  async execute(ctx: CorpPhaseContext): Promise<CorpPhase> {
    const { ns, log, logger } = ctx;
    const corp = ns.corporation;
    const { tobacco } = CORP_CONFIG.divisions;
    const mainCity = CORP_CONFIG.mainCity;

    const divInfo = corp.getDivision(tobacco.name);

    const hasMainCity = divInfo.cities.includes(mainCity);
    const mainOfficeSize = hasMainCity
      ? corp.getOffice(tobacco.name, mainCity).size
      : 0;

    if (!hasMainCity || mainOfficeSize < 60) {
      log(
        `HQ-Bürogröße unzureichend (${mainOfficeSize}/60). Zurück zu INIT_TOBACCO...`,
        "WARN",
      );
      return "INIT_TOBACCO";
    }

    // 1. Mitarbeiter-Moral pflegen
    for (const city of divInfo.cities) {
      maintainEmployeeMorale(ns, tobacco.name, city);
    }

    // 2. Booster-Materialien im Lager auf Ziel-Verhältnis halten
    // a. Tobacco-Booster im neuen Lager nachkaufen
    maintainRatios(
      ns,
      CORP_CONFIG.divisions.tobacco.name,
      TOBACCO_BOOST_RATIOS,
      0.7,
    );

    // b. Agrar-Booster im ebenfalls gewachsenen Lager nachkaufen
    maintainRatios(
      ns,
      CORP_CONFIG.divisions.agri.name,
      AGRI_BOOST_RATIOS.R2,
      0.7,
    );

    // c. Chemie-Booster im ebenfalls gewachsenen Lager nachkaufen
    maintainRatios(
      ns,
      CORP_CONFIG.divisions.chem.name,
      CHEM_BOOST_RATIOS.R2,
      0.7,
    );

// 3. Forschungen streng nach Priorität durchführen & R&D Reallokation
    let allResearched = true;

    for (const tech of CORP_RESEARCH_PRIORITY) {
      if (!corp.hasResearched(tobacco.name, tech)) {
        allResearched = false;
        const currentRP = corp.getDivision(tobacco.name).researchPoints;
        const cost = corp.getResearchCost(tobacco.name, tech);

        if (currentRP >= cost) {
          try {
            corp.research(tobacco.name, tech);
            log(`[Tobacco] Erforscht: ${tech}`, "SUCCESS");
          } catch {
            break;
          }
        } else {
          break;
        }
      }
    }

    // Falls ALLE Forschungen abgeschlossen sind: R&D-Stellen komplett auflösen!
    if (allResearched) {
      for (const city of divInfo.cities) {
        const isHQ = city === mainCity;
        const currentOffice = corp.getOffice(tobacco.name, city);

        // Nur anpassen, wenn noch R&D-Mitarbeiter vorhanden sind
        if (currentOffice.employeeJobs["Research & Development"] > 0) {
          const targetJobs = isHQ
            ? CORP_CONFIG.jobDistribution.tobaccoHQ60Maxed
            : CORP_CONFIG.jobDistribution.support12Maxed;

          setupOfficeAndJobs(
            ns,
            tobacco.name,
            city,
            currentOffice.size,
            targetJobs,
          );
          log(
            `[Tobacco] Forschung abgeschlossen! R&D-Personal in ${city} umverteilt.`,
            "INFO",
          );
        }
      }
    }

    // 4. Produkte verwalten & Verkaufen (KORREKTUR PUNKT 3: TA.II Optimierung)
    let products = corp.getDivision(tobacco.name).products;
    const hasTA2 = corp.hasResearched(tobacco.name, "Market-TA.II");

    for (const prodName of products) {
      const prod = corp.getProduct(tobacco.name, mainCity, prodName);
      if (prod.developmentProgress === 100) {
        // Market-TA.II ist eine globale Produkteinstellung (einmalig pro Produkt, nicht pro Stadt)
        if (hasTA2) {
          corp.setProductMarketTA2(tobacco.name, prodName, true);
        }

        for (const city of divInfo.cities) {
          // Solange kein Market-TA.II vorhanden ist, verkaufen wir manuell zum 2x Marktpreis.
          // Sobald TA.II aktiv ist, reicht "MP", da das Spiel die Preise dynamisch regelt.
          const price = hasTA2 ? "MP" : "MP * 2";
          corp.sellProduct(tobacco.name, city, prodName, "MAX", price, true);
        }
      }
    }

    // 5. Maximale Produktkapazität ermitteln
    let maxProducts = 3;
    if (corp.hasResearched(tobacco.name, "uPgrade: Capacity.I")) maxProducts++;
    if (corp.hasResearched(tobacco.name, "uPgrade: Capacity.II")) maxProducts++;

    const isDeveloping = products.some(
      (p) =>
        corp.getProduct(tobacco.name, mainCity, p).developmentProgress < 100,
    );

    if (!isDeveloping) {
      // (KORREKTUR PUNKT 1: Array-Synchronisation nach discontinuing)
      if (products.length >= maxProducts) {
        const oldestProduct = products[0];
        corp.discontinueProduct(tobacco.name, oldestProduct);
        log(
          `[Tobacco] Ältester Artikel '${oldestProduct}' eingestellt.`,
          "INFO",
        );
        // Nach dem Einstellen das Produkt-Array aus der API neu laden:
        products = corp.getDivision(tobacco.name).products;
      }

      // Freie Produktnummer ermitteln
      let prodIndex = 1;
      while (products.includes(`Tobacco-${prodIndex}`)) {
        prodIndex++;
      }
      const newProdName = `Tobacco-${prodIndex}`;

      // (KORREKTUR PUNKT 2: Sauberer Budget-Split & Maximum-Check)
      // Bitburner erlaubt maximal $1.000.000.000 je Kategorie (Design & Marketing),
      // also insgesamt max. $2.000.000.000 pro Produkt.
      const availableFunds = corp.getCorporation().funds;
      const minRequired = 2_000_000;
      const maxPerCategory = 1_000_000_000; // Maximum laut Bitburner-API

      // Wir investieren 5% der verfügbaren Mittel pro Kategorie (10% insgesamt), gedeckelt auf $1 Mrd.
      const categoryInvestment = Math.min(
        maxPerCategory,
        Math.max(minRequired / 2, availableFunds * 0.05),
      );
      const totalInvestment = categoryInvestment * 2;

      if (totalInvestment >= minRequired) {
        corp.makeProduct(
          tobacco.name,
          mainCity,
          newProdName,
          categoryInvestment,
          categoryInvestment,
        );
        log(
          `[Tobacco] Neues Produkt gestartet: ${newProdName} (Budget: $${ns.format.number(totalInvestment, 2)})`,
          "SUCCESS",
        );
      }
    }

    // 6. Upgrades kaufen & Reinvestition
    if (corp.getCorporation().funds > 1_000_000_000) {
      buyCorporationUpgrades(ns, 0.1, logger);

      const wilsonCost = corp.getUpgradeLevelCost("Wilson Analytics");
      if (corp.getCorporation().funds >= wilsonCost) {
        corp.levelUpgrade("Wilson Analytics");
        log(
          `Wilson Analytics auf Level ${corp.getUpgradeLevel("Wilson Analytics")} erhöht!`,
          "SUCCESS",
        );
      } else {
        const advertCost = corp.getHireAdVertCost(tobacco.name);
        if (corp.getCorporation().funds >= advertCost * 2) {
          corp.hireAdVert(tobacco.name);
        }
      }
    }

    // 7. Börsengang / Dividenden
    const corpData = corp.getCorporation();
    if (!corpData.public) {
      if (corpData.revenue > 100_000_000_000) {
        corp.goPublic(0);
        log("** PHILIP MATRIX IST AN DIE BÖRSE GEGANGEN! **", "SUCCESS");
      }
    } else {
      corp.issueDividends(0.5);
    }

    return ctx.currentPhase;
  }
}
