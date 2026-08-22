import { CityName, CorpMaterialName, NS } from "@ns";
import {
  CORP_CONFIG,
  CORP_RESEARCH_PRIORITY,
  CorpPhase,
} from "../../shared/constants/corporation";
import {
  setupOfficeAndJobs,
  upgradeWarehouseToLevel,
  purchaseBoosterMaterials,
  maintainEmployeeMorale,
} from "/domain/corporation/corporation-helpers";

let spikeState: "IDLE" | "ACCUMULATING" | "SELLING" = "IDLE";
let spikeTicks = 0;
let productCounter = 1;

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();

  const corp = ns.corporation;
  let currentPhase: CorpPhase = "INIT_AGRI";

  ns.print(`[CORP] Manager gestartet. Starte Phase: ${currentPhase}`);

  while (true) {
    await corp.nextUpdate();

    if (!corp.hasCorporation()) {
      ns.print("[CORP] Keine Corporation vorhanden. Versuche Gründung...");
      if (corp.createCorporation(CORP_CONFIG.corpName, true)) {
        ns.print(`[CORP] ${CORP_CONFIG.corpName} erfolgreich gegründet!`);
      } else {
        ns.print("[CORP] Fehler bei Gründung (Zu wenig Kapital?)");
        continue;
      }
    }

    switch (currentPhase) {
      case "INIT_AGRI":
        currentPhase = await handleInitAgri(ns);
        break;
      case "AGRI_BOOST":
        currentPhase = await handleAgriBoost(ns);
        break;
      case "INVESTOR_1":
        currentPhase = await handleInvestor1(ns);
        break;
      case "INIT_CHEM":
        currentPhase = await handleInitChem(ns);
        break;
      case "EXPORT_LOOP":
        currentPhase = await handleExportLoop(ns);
        break;
      case "INVESTOR_2":
        currentPhase = await handleInvestor2(ns);
        break;
      case "INIT_TOBACCO":
        currentPhase = await handleInitTobacco(ns);
        break;
      case "TOBACCO_LOOP":
        await handleTobaccoLoop(ns);
        break;
    }
  }
}

async function handleInitAgri(ns: NS): Promise<CorpPhase> {
  const corp = ns.corporation;
  const { agri } = CORP_CONFIG.divisions;

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

  return "AGRI_BOOST";
}

async function handleAgriBoost(ns: NS): Promise<CorpPhase> {
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
    upgradeWarehouseToLevel(ns, agri.name, city, 3);

    const ready = await purchaseBoosterMaterials(
      ns,
      agri.name,
      city,
      CORP_CONFIG.agriBoosterR1,
    );
    maintainEmployeeMorale(ns, agri.name, city);

    if (!ready) {
      allCitiesReady = false;
    }
  }

  if (allCitiesReady) {
    ns.print("[CORP] Phase AGRI_BOOST abgeschlossen! Alle Lager sind bereit.");
    return "INVESTOR_1";
  }

  return "AGRI_BOOST";
}

async function handleInvestor1(ns: NS): Promise<CorpPhase> {
  const corp = ns.corporation;
  const { agri } = CORP_CONFIG.divisions;

  if (spikeState === "IDLE") {
    ns.print("[CORP] Starte Profit-Spike: Stoppe Verkäufe für 2 Ticks...");
    for (const city of CORP_CONFIG.cities) {
      corp.sellMaterial(agri.name, city, "Plants", "0", "MP");
      corp.sellMaterial(agri.name, city, "Food", "0", "MP");
    }
    spikeState = "ACCUMULATING";
    spikeTicks = 0;
    return "INVESTOR_1";
  }

  if (spikeState === "ACCUMULATING") {
    spikeTicks++;
    if (spikeTicks < 2) return "INVESTOR_1";

    ns.print(
      "[CORP] Lager gefüllt! Stelle Belegschaft auf Business/Operations & öffne Ventile...",
    );
    for (const city of CORP_CONFIG.cities) {
      setupOfficeAndJobs(ns, agri.name, city, 6, {
        Business: 3,
        Operations: 3,
      });
      corp.sellMaterial(agri.name, city, "Plants", "MAX", "MP");
      corp.sellMaterial(agri.name, city, "Food", "MAX", "MP");
    }
    spikeState = "SELLING";
    return "INVESTOR_1";
  }

  if (spikeState === "SELLING") {
    const offer = corp.getInvestmentOffer();
    ns.print(`[CORP] Investor 1 Angebot: ${ns.format.number(offer.funds)} $`);

    if (offer.funds >= 200_000_000_000) {
      if (corp.acceptInvestmentOffer()) {
        ns.print(
          `[CORP] Erfolgreich Investor 1 angenommen! Kapital: ${ns.format.number(offer.funds)} $`,
        );

        for (const city of CORP_CONFIG.cities) {
          setupOfficeAndJobs(
            ns,
            agri.name,
            city,
            6,
            CORP_CONFIG.jobDistribution.support6,
          );
        }
        spikeState = "IDLE";
        return "INIT_CHEM";
      }
    }
  }

  return "INVESTOR_1";
}

async function handleInitChem(ns: NS): Promise<CorpPhase> {
  const corp = ns.corporation;
  const { chem } = CORP_CONFIG.divisions;

  ns.print("[CORP] Gründe Chemical-Division...");
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

  return "EXPORT_LOOP";
}

async function handleExportLoop(ns: NS): Promise<CorpPhase> {
  const { agri, chem } = CORP_CONFIG.divisions;

  ns.print("[CORP] Richte Export-Routen mit IPROD * -1 ein...");

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

  ns.print("[CORP] Export-Loop aktiv! Pflanzenqualität steigt...");
  return "INVESTOR_2";
}

async function handleInvestor2(ns: NS): Promise<CorpPhase> {
  const corp = ns.corporation;
  const { agri, chem } = CORP_CONFIG.divisions;

  if (spikeState === "IDLE") {
    ns.print("[CORP] Starte Investor-2 Profit-Spike: Stoppe Verkäufe...");
    for (const city of CORP_CONFIG.cities) {
      corp.sellMaterial(agri.name, city, "Plants", "0", "MP");
      corp.sellMaterial(agri.name, city, "Food", "0", "MP");
      corp.sellMaterial(chem.name, city, "Chemicals", "0", "MP");
    }
    spikeState = "ACCUMULATING";
    spikeTicks = 0;
    return "INVESTOR_2";
  }

  if (spikeState === "ACCUMULATING") {
    spikeTicks++;
    if (spikeTicks < 2) return "INVESTOR_2";

    ns.print("[CORP] Öffne Ventile für Investor 2...");
    for (const city of CORP_CONFIG.cities) {
      setupOfficeAndJobs(ns, agri.name, city, 6, {
        Business: 3,
        Operations: 3,
      });
      setupOfficeAndJobs(ns, chem.name, city, 6, {
        Business: 3,
        Operations: 3,
      });

      corp.sellMaterial(agri.name, city, "Plants", "MAX", "MP");
      corp.sellMaterial(agri.name, city, "Food", "MAX", "MP");
      corp.sellMaterial(chem.name, city, "Chemicals", "MAX", "MP");
    }
    spikeState = "SELLING";
    return "INVESTOR_2";
  }

  if (spikeState === "SELLING") {
    const offer = corp.getInvestmentOffer();
    ns.print(`[CORP] Investor 2 Angebot: ${ns.format.number(offer.funds)} $`);

    if (offer.funds >= 2_000_000_000_000) {
      if (corp.acceptInvestmentOffer()) {
        ns.print(
          `[CORP] Erfolgreich Investor 2 angenommen! Kapital: ${ns.format.number(offer.funds)} $`,
        );

        for (const city of CORP_CONFIG.cities) {
          setupOfficeAndJobs(
            ns,
            agri.name,
            city,
            6,
            CORP_CONFIG.jobDistribution.support6,
          );
          setupOfficeAndJobs(
            ns,
            chem.name,
            city,
            6,
            CORP_CONFIG.jobDistribution.chem6,
          );
        }
        spikeState = "IDLE";
        return "INIT_TOBACCO";
      }
    }
  }

  return "INVESTOR_2";
}

async function handleInitTobacco(ns: NS): Promise<CorpPhase> {
  const corp = ns.corporation;
  const { tobacco, agri } = CORP_CONFIG.divisions;

  ns.print("[CORP] Gründe Endgame-Sparte: Tobacco...");
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

    // Pflanzexporte aus Landwirtschaft sicherstellen
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

  return "TOBACCO_LOOP";
}

async function handleTobaccoLoop(ns: NS): Promise<void> {
  const corp = ns.corporation;
  const { tobacco } = CORP_CONFIG.divisions;
  const mainCity = CORP_CONFIG.mainCity;

  // A. Moral & Energie auf 100% halten
  for (const city of CORP_CONFIG.cities) {
    maintainEmployeeMorale(ns, tobacco.name, city);
  }

  // B. Forschungs-Manager (Schaltet Market-TA.II & Buffs frei)
  for (const tech of CORP_RESEARCH_PRIORITY) {
    if (!corp.hasResearched(tobacco.name, tech)) {
      const cost = corp.getResearchCost(tobacco.name, tech);
      if (corp.getDivision(tobacco.name).researchPoints >= cost) {
        corp.research(tobacco.name, tech);
        ns.print(`[CORP] Erforscht: ${tech}`);
      }
    }
  }

  // C. Produkt-Lifecycle
  const divInfo = corp.getDivision(tobacco.name);
  const products = divInfo.products;
  const hasTA2 = corp.hasResearched(tobacco.name, "Market-TA.II");

  // 1. Fertige Produkte auf Market-TA.II oder MP konfigurieren
  for (const prodName of products) {
    const prod = corp.getProduct(tobacco.name, mainCity, prodName);
    if (prod.developmentProgress === 100) {
      if (hasTA2) {
        corp.setProductMarketTA2(tobacco.name, prodName, true);
      } else {
        corp.sellProduct(tobacco.name, mainCity, prodName, "MAX", "MP", true);
      }
    }
  }

  // 2. Prüfen, ob ein neues Produkt gestartet werden muss
  let maxProducts = 3;
  if (corp.hasResearched(tobacco.name, "uPgrade: Capacity.I")) maxProducts++;
  if (corp.hasResearched(tobacco.name, "uPgrade: Capacity.II")) maxProducts++;

  // Altprodukt einstellen, wenn Limit erreicht ist
  if (products.length >= maxProducts) {
    const oldestProduct = products[0];
    corp.discontinueProduct(tobacco.name, oldestProduct);
    ns.print(`[CORP] Produkt ${oldestProduct} eingestellt.`);
  }

  // D. Upgrades & Marketing Skalierung (Erst Wilson Analytics, dann AdVert)[cite: 1]
  if (corp.getCorporation().funds > 1_000_000_000) {
    const wilsonCost = corp.getUpgradeLevelCost("Wilson Analytics");
    if (corp.getCorporation().funds >= wilsonCost) {
      corp.levelUpgrade("Wilson Analytics");
    } else {
      const advertCost = corp.getHireAdVertCost(tobacco.name);
      if (corp.getCorporation().funds >= advertCost * 2) {
        corp.hireAdVert(tobacco.name);
      }
    }
  }

  // E. IPO (Börsengang) & Geld-Transfer an den Spieler![cite: 1]
  const corpData = corp.getCorporation();
  if (!corpData.public) {
    // Sobald die Firma extrem lukrativ ist, an die Börse gehen
    if (corpData.revenue > 100_000_000_000) {
      corp.goPublic(0);
      ns.print("[CORP] ** PHILIP MATRIX IST AN DIE BÖRSE GEGANGEN! **");
    }
  } else {
    // 50% des Gewinns direkt als Dividende auf dein persönliches Spielerkonto überweisen![cite: 1]
    corp.issueDividends(0.5);
  }
}

function safeExportMaterial(
  ns: NS,
  sourceDiv: string,
  sourceCity: CityName,
  targetDiv: string,
  targetCity: CityName, // Typ von 'string' auf 'CityName' angepasst
  material: CorpMaterialName,
  amount: string,
): void {
  const corp = ns.corporation;
  const mat = corp.getMaterial(sourceDiv, sourceCity, material);

  const existing = mat.exports.find(
    (e) => e.division === targetDiv && e.city === targetCity,
  );

  if (existing) {
    const normalizedExisting = existing.amount.replace(/\s+/g, "");
    const normalizedNew = amount.replace(/\s+/g, "");
    if (normalizedExisting === normalizedNew) return;

    corp.cancelExportMaterial(
      sourceDiv,
      sourceCity,
      targetDiv,
      targetCity,
      material,
    );
  }

  corp.exportMaterial(
    sourceDiv,
    sourceCity,
    targetDiv,
    targetCity,
    material,
    amount,
  );
}