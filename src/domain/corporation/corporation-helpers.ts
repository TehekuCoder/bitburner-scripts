import {
  NS,
  CityName,
  CorpMaterialName,
  CorpEmployeePosition,
  CorpUpgradeName,
} from "@ns";

export type CorpJobRole = Exclude<CorpEmployeePosition, "Unassigned">;
export type MaterialTargets = Partial<Record<CorpMaterialName, number>>;
export type JobAssignments = Partial<Record<CorpJobRole, number>>;

export const ALL_JOBS: CorpJobRole[] = [
  "Operations",
  "Engineer",
  "Business",
  "Management",
  "Research & Development",
  "Intern",
];

/**
 * Kauft Booster-Materialien für eine Division gezielt bis zu den Target-Werten.
 */
export async function purchaseBoosterMaterials(
  ns: NS,
  divisionName: string,
  cityName: CityName,
  targets: MaterialTargets,
): Promise<boolean> {
  const corp = ns.corporation;
  const warehouse = corp.getWarehouse(divisionName, cityName);
  let allTargetsMet = true;

  const entries = Object.entries(targets) as [CorpMaterialName, number][];

  for (const [matName, targetQty] of entries) {
    if (targetQty === undefined || targetQty <= 0) continue;

    const mat = corp.getMaterial(divisionName, cityName, matName);
    const currentQty = mat.stored;

    if (currentQty < targetQty) {
      allTargetsMet = false;
      const needed = targetQty - currentQty;
      const buyRate = Math.ceil(needed / 10);

      const freeSpace = warehouse.size - warehouse.sizeUsed;
      const safeSpacePuffer = warehouse.size * 0.2;

      if (freeSpace > safeSpacePuffer) {
        corp.buyMaterial(divisionName, cityName, matName, buyRate);
      } else {
        corp.buyMaterial(divisionName, cityName, matName, 0);
      }
    } else {
      corp.buyMaterial(divisionName, cityName, matName, 0);
    }
  }

  return allTargetsMet;
}

/**
 * Baut Büros aus, stellt Mitarbeiter ein und weist Jobs typ-sicher zu.
 */
export function setupOfficeAndJobs(
  ns: NS,
  divisionName: string,
  cityName: CityName,
  targetSize: number,
  jobs: JobAssignments,
): void {
  const corp = ns.corporation;
  let office = corp.getOffice(divisionName, cityName);

  if (office.size < targetSize) {
    const upgradeCost = corp.getOfficeSizeUpgradeCost(
      divisionName,
      cityName,
      targetSize - office.size,
    );
    if (corp.getCorporation().funds >= upgradeCost) {
      corp.upgradeOfficeSize(divisionName, cityName, targetSize - office.size);
      office = corp.getOffice(divisionName, cityName);
    }
  }

  while (office.numEmployees < office.size) {
    if (!corp.hireEmployee(divisionName, cityName)) break;
    office = corp.getOffice(divisionName, cityName);
  }

  for (const job of ALL_JOBS) {
    corp.setJobAssignment(divisionName, cityName, job, 0);
  }

  const jobEntries = Object.entries(jobs) as [CorpJobRole, number][];
  for (const [job, count] of jobEntries) {
    if (count && count > 0) {
      corp.setJobAssignment(divisionName, cityName, job, count);
    }
  }
}

export function upgradeWarehouseToLevel(
  ns: NS,
  divisionName: string,
  cityName: CityName,
  targetLevel: number,
): void {
  const corp = ns.corporation;
  if (!corp.hasWarehouse(divisionName, cityName)) return;

  const warehouse = corp.getWarehouse(divisionName, cityName);
  if (warehouse.level < targetLevel) {
    const levelDiff = targetLevel - warehouse.level;
    const cost = corp.getUpgradeWarehouseCost(
      divisionName,
      cityName,
      levelDiff,
    );
    if (corp.getCorporation().funds >= cost) {
      corp.upgradeWarehouse(divisionName, cityName, levelDiff);
    }
  }
}

export function maintainEmployeeMorale(
  ns: NS,
  divisionName: string,
  cityName: CityName,
): void {
  const corp = ns.corporation;
  const office = corp.getOffice(divisionName, cityName);

  if (office.avgMorale < 98 || office.avgEnergy < 98) {
    corp.buyTea(divisionName, cityName);
    corp.throwParty(divisionName, cityName, 500_000);
  }
}

/**
 * Kauft ausbalanciert allgemeine Corporation-Upgrades.
 * Nutzt maximal `maxBudgetRatio` des aktuellen Guthabens (Standard: 10%),
 * damit immer genug Kapital für andere Investitionen bleibt.
 */
export function buyCorporationUpgrades(ns: NS, maxBudgetRatio = 0.1): void {
  const corp = ns.corporation;
  const funds = corp.getCorporation().funds;
  if (funds <= 0) return;

  const budget = funds * maxBudgetRatio;
  const upgrades: CorpUpgradeName[] = [
    "Smart Storage",
    "Smart Factories",
    "FocusWires",
    "Neural Accelerators",
    "Speech Processor Implants",
    "Nuoptimal Nootropic Injector Implants",
    "ABC SalesBots",
    "Project Insight",
  ];

  let bought = true;
  while (bought) {
    bought = false;
    let cheapestUpgrade: CorpUpgradeName | null = null;
    let minCost = Infinity;

    for (const upgrade of upgrades) {
      const cost = corp.getUpgradeLevelCost(upgrade);
      if (cost < minCost) {
        minCost = cost;
        cheapestUpgrade = upgrade;
      }
    }

    if (
      cheapestUpgrade &&
      minCost <= budget &&
      minCost <= corp.getCorporation().funds
    ) {
      corp.levelUpgrade(cheapestUpgrade);
      ns.print(
        `[CORP] Upgrade gekauft: ${cheapestUpgrade} (Lvl ${corp.getUpgradeLevel(cheapestUpgrade)})`,
      );
      bought = true;
    }
  }
}
