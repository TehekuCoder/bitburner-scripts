import {
  NS,
  CityName,
  CorpMaterialName,
  CorpEmployeePosition,
  CorpUpgradeName,
  CorpUnlockName,
} from "@ns";

import { LoggerClient } from "../../infrastructure/logging/logger-client";

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

export async function purchaseBoosterMaterials(
  ns: NS,
  divisionName: string,
  cityName: CityName,
  targets: MaterialTargets,
): Promise<boolean> {
  const corp = ns.corporation;
  if (!corp.getCorporation().divisions.includes(divisionName)) return true;
  if (!corp.getDivision(divisionName).cities.includes(cityName)) return true;
  if (!corp.hasWarehouse(divisionName, cityName)) return true;

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

export function setupOfficeAndJobs(
  ns: NS,
  divisionName: string,
  cityName: CityName,
  targetSize: number,
  jobs: JobAssignments,
): boolean {
  const corp = ns.corporation;
  const office = corp.getOffice(divisionName, cityName);

  // 1. Prüfen & Erhöhen der Bürokapazität
  if (office.size < targetSize) {
    const sizeDiff = targetSize - office.size;
    const upgradeCost = corp.getOfficeSizeUpgradeCost(
      divisionName,
      cityName,
      sizeDiff,
    );

    if (corp.getCorporation().funds < upgradeCost) {
      // Nicht genügend Kapital für das Upgrade vorhanden
      return false;
    }
    corp.upgradeOfficeSize(divisionName, cityName, sizeDiff);
  }

  // 2. Neue Mitarbeiter einstellen bis targetSize erreicht ist
  let currentOffice = corp.getOffice(divisionName, cityName);
  while (currentOffice.numEmployees < targetSize) {
    if (!corp.hireEmployee(divisionName, cityName)) {
      break;
    }
    currentOffice = corp.getOffice(divisionName, cityName);
  }

  // Abbrechen, falls nicht genügend Mitarbeiter eingestellt werden konnten
  if (currentOffice.numEmployees < targetSize) {
    return false;
  }

  // 3. ALLE Jobzuweisungen zuerst auf 0 zurücksetzen (Verwendung von ALL_JOBS)
  for (const job of ALL_JOBS) {
    corp.setJobAssignment(divisionName, cityName, job, 0);
  }

  // 4. Jobs neu zuweisen mit explizitem Cast auf CorpJobRole
  for (const [job, count] of Object.entries(jobs) as [CorpJobRole, number][]) {
    if (count && count > 0) {
      corp.setJobAssignment(divisionName, cityName, job, count);
    }
  }

  return true;
}

export function upgradeWarehouseToLevel(
  ns: NS,
  divisionName: string,
  cityName: CityName,
  targetLevel: number,
): void {
  const corp = ns.corporation;
  if (!corp.getCorporation().divisions.includes(divisionName)) return;
  if (!corp.getDivision(divisionName).cities.includes(cityName)) return;
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
  if (!corp.getCorporation().divisions.includes(divisionName)) return;
  if (!corp.getDivision(divisionName).cities.includes(cityName)) return;

  const office = corp.getOffice(divisionName, cityName);

  if (office.avgMorale < 98 || office.avgEnergy < 98) {
    corp.buyTea(divisionName, cityName);
    corp.throwParty(divisionName, cityName, 500_000);
  }
}

export function buyCorporationUpgrades(
  ns: NS,
  maxBudgetRatio = 0.1,
  logger?: LoggerClient,
): void {
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
      const msg = `Upgrade gekauft: ${cheapestUpgrade} (Lvl ${corp.getUpgradeLevel(cheapestUpgrade)})`;
      if (logger) {
        logger.success(msg);
      } else {
        ns.print(`[CORP] ${msg}`);
      }
      bought = true;
    }
  }
}

export function safeExportMaterial(
  ns: NS,
  sourceDiv: string,
  sourceCity: CityName,
  targetDiv: string,
  targetCity: CityName,
  material: CorpMaterialName,
  amount: string,
): void {
  const corp = ns.corporation;
  if (
    !corp.getCorporation().divisions.includes(sourceDiv) ||
    !corp.getCorporation().divisions.includes(targetDiv)
  ) {
    return;
  }

  if (
    !corp.getDivision(sourceDiv).cities.includes(sourceCity) ||
    !corp.getDivision(targetDiv).cities.includes(targetCity)
  ) {
    return;
  }

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

export function ensureUnlock(
  ns: NS,
  unlockName: CorpUnlockName,
  logger?: LoggerClient,
): boolean {
  const corp = ns.corporation;
  if (corp.hasUnlock(unlockName)) return true;

  const cost = corp.getUnlockCost(unlockName);
  if (corp.getCorporation().funds >= cost) {
    corp.purchaseUnlock(unlockName);
    const msg = `Unlock erworben: ${unlockName}`;
    if (logger) {
      logger.success(msg);
    } else {
      ns.print(`[CORP] ${msg}`);
    }
    return true;
  }
  return false;
}
export function buyPhaseUnlocks(ns: NS, currentPhase: string): void {
  ensureUnlock(ns, "Smart Supply");

  if (
    currentPhase.includes("CHEM") ||
    currentPhase.includes("EXPORT") ||
    currentPhase.includes("TOBACCO")
  ) {
    ensureUnlock(ns, "Export");
  }
}
