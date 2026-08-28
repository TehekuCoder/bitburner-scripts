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

    for (const city of divInfo.cities) {
      maintainEmployeeMorale(ns, tobacco.name, city);
    }

    for (const tech of CORP_RESEARCH_PRIORITY) {
      if (!corp.hasResearched(tobacco.name, tech)) {
        const cost = corp.getResearchCost(tobacco.name, tech);
        if (divInfo.researchPoints >= cost) {
          try {
            corp.research(tobacco.name, tech);
            log(`[Tobacco] Erforscht: ${tech}`, "SUCCESS");
          } catch {
            // Voraussetzungen fehlen eventuell noch
          }
        }
      }
    }

    const products = divInfo.products;
    const hasTA2 = corp.hasResearched(tobacco.name, "Market-TA.II");

    for (const prodName of products) {
      const prod = corp.getProduct(tobacco.name, mainCity, prodName);
      if (prod.developmentProgress === 100) {
        for (const city of divInfo.cities) {
          const price = hasTA2 ? "MP" : "MP * 2";
          corp.sellProduct(tobacco.name, city, prodName, "MAX", price, true);

          if (hasTA2) {
            corp.setProductMarketTA2(tobacco.name, prodName, true);
          }
        }
      }
    }

    let maxProducts = 3;
    if (corp.hasResearched(tobacco.name, "uPgrade: Capacity.I")) maxProducts++;
    if (corp.hasResearched(tobacco.name, "uPgrade: Capacity.II")) maxProducts++;

    const isDeveloping = products.some(
      (p) =>
        corp.getProduct(tobacco.name, mainCity, p).developmentProgress < 100,
    );

    if (!isDeveloping) {
      if (products.length >= maxProducts) {
        const oldestProduct = products[0];
        corp.discontinueProduct(tobacco.name, oldestProduct);
        log(
          `[Tobacco] Ältester Artikel '${oldestProduct}' eingestellt.`,
          "INFO",
        );
      }

      let prodIndex = 1;
      while (products.includes(`Tobacco-${prodIndex}`)) {
        prodIndex++;
      }
      const newProdName = `Tobacco-${prodIndex}`;

      const availableFunds = corp.getCorporation().funds;
      const totalInvestment = Math.min(
        2_000_000_000,
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
          `[Tobacco] Neues Produkt gestartet: ${newProdName} (Budget: $${ns.format.number(totalInvestment, 2)})`,
          "SUCCESS",
        );
      }
    }

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
