// lib/sleeve-utils.ts

import {
  NS,
  FactionName,
  FactionWorkType,
  CompanyName,
  SleevePerson,
  SleeveTask,
  Player,
  CrimeType,
  GymLocationName,
  UniversityLocationName,
} from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { MEGACORPS, COMBAT_STATS, GYM_STAT_MAP } from "lib/constants.js";
import { loadGangState } from "/lib/state.js";
import {
  SleeveOptions,
  SleeveMode,
  SleeveData,
  SleeveGangUnlockStatus,
} from "./types/sleeves.js";

const TRAVEL_COST = 200_000;

const CITY_GYMS: Record<string, GymLocationName> = {
  Volhaven: "Powerhouse Gym",
  "Sector-12": "Iron Gym",
  Aevum: "Crush Fitness Gym",
};

const CITY_UNIS: Record<string, UniversityLocationName> = {
  Volhaven: "ZB Institute of Technology",
  "Sector-12": "Rothman University",
  Aevum: "Summit University",
};

export const ALL_CRIMES: CrimeType[] = [
  "Shoplift",
  "Rob Store",
  "Mug",
  "Larceny",
  "Deal Drugs",
  "Bond Forgery",
  "Traffick Arms",
  "Homicide",
  "Grand Theft Auto",
  "Kidnap",
  "Assassination",
  "Heist",
];

const CRIME_KARMA_MAP: Record<CrimeType, number> = {
  Shoplift: 0.1,
  "Rob Store": 0.5,
  Mug: 0.25,
  Larceny: 1.5,
  "Deal Drugs": 0.5,
  "Bond Forgery": 0.1,
  "Traffick Arms": 1.0,
  Homicide: 3.0,
  "Grand Theft Auto": 1.0,
  Kidnap: 6.0,
  Assassination: 10.0,
  Heist: 15.0,
};

/**
 * Berechnet die Verbrechen-Erfolgschance für einen Sleeve über eine gewichtete Heuristik.
 */
export function getSleeveCrimeChance(
  ns: NS,
  crime: CrimeType,
  stats: SleevePerson,
): number {
  const { hacking, strength, defense, dexterity, agility, charisma } =
    stats.skills;
  let chance = 0;

  switch (crime) {
    case "Shoplift":
      chance = (dexterity * 1.0 + agility * 1.0) / 30;
      break;
    case "Rob Store":
      chance = (agility * 0.8 + dexterity * 0.8 + hacking * 0.4) / 80;
      break;
    case "Mug":
      chance =
        (strength * 0.5 + defense * 0.5 + dexterity * 0.5 + agility * 0.5) /
        100;
      break;
    case "Larceny":
      chance = (agility * 0.8 + dexterity * 0.8 + hacking * 0.4) / 150;
      break;
    case "Deal Drugs":
      chance = (charisma * 1.0 + agility * 0.5 + dexterity * 0.5) / 200;
      break;
    case "Bond Forgery":
      chance = (hacking * 1.0 + dexterity * 0.5) / 250;
      break;
    case "Traffick Arms":
      chance =
        (strength * 0.4 + defense * 0.4 + charisma * 0.4 + agility * 0.4) / 300;
      break;
    case "Homicide":
      chance =
        (strength * 0.6 + defense * 0.6 + dexterity * 0.6 + agility * 0.6) /
        350;
      break;
    case "Grand Theft Auto":
      chance = (hacking * 0.4 + agility * 0.8 + dexterity * 0.8) / 400;
      break;
    case "Kidnap":
      chance =
        (charisma * 0.6 + strength * 0.6 + dexterity * 0.6 + agility * 0.6) /
        500;
      break;
    case "Assassination":
      chance = (dexterity * 0.8 + agility * 0.8 + strength * 0.5) / 600;
      break;
    case "Heist":
      chance =
        (hacking + strength + defense + dexterity + agility + charisma) / 800;
      break;
    default:
      chance = (strength + defense + dexterity + agility) / 400;
      break;
  }

  // Schock-Penalty einkalkulieren
  const shockPenalty = (100 - stats.shock) / 100;
  return Math.min(1.0, Math.max(0.01, chance * shockPenalty));
}

/**
 * Prüft den Freischaltstatus von Sleeves und Gang.
 */
export function checkSleeveGangStatus(ns: NS): SleeveGangUnlockStatus {
  const hasSleeves = ns.sleeve !== undefined && ns.sleeve.getNumSleeves() > 0;

  let hasGangApi = false;
  let inGang = false;

  try {
    if (ns.gang !== undefined) {
      hasGangApi = true;
      inGang = ns.gang.inGang();
    }
  } catch {
    /* Gang API nicht vorhanden */
  }

  if (!inGang) {
    const gangState = loadGangState(ns);
    if (gangState?.hasGang) {
      inGang = true;
    }
  }

  const currentKarma = ns.heart.break();
  const shouldGrindKarma = !inGang && currentKarma > -54000;

  return {
    hasSleeves,
    hasGangApi,
    inGang,
    shouldGrindKarma,
  };
}

function ensureVolhaven(
  ns: NS,
  i: number,
  stats: SleevePerson,
  currentMoney: number,
): { success: boolean; updatedMoney: number; currentCity: string } {
  if (stats.city === "Volhaven") {
    return {
      success: true,
      updatedMoney: currentMoney,
      currentCity: "Volhaven",
    };
  }
  if (currentMoney >= TRAVEL_COST) {
    if (ns.sleeve.travel(i, "Volhaven")) {
      return {
        success: true,
        updatedMoney: currentMoney - TRAVEL_COST,
        currentCity: "Volhaven",
      };
    }
  }
  return {
    success: false,
    updatedMoney: currentMoney,
    currentCity: stats.city,
  };
}

function getGymForCity(city: string): GymLocationName {
  return CITY_GYMS[city] ?? "Iron Gym";
}

function getUniForCity(city: string): UniversityLocationName {
  return CITY_UNIS[city] ?? "Rothman University";
}

function getGangFactionName(ns: NS): FactionName | null {
  try {
    if (ns.gang && ns.gang.inGang()) {
      return ns.gang.getGangInformation().faction as FactionName;
    }
  } catch {
    /* Gang-API nicht verfügbar */
  }

  const gangState = loadGangState(ns);
  if (gangState?.hasGang && gangState.gangFaction) {
    return gangState.gangFaction as FactionName;
  }

  return null;
}

export function getFactionsNeedingRep(
  ns: NS,
  playerFactions: string[],
  ownedAugs: string[],
): FactionName[] {
  if (!ns.singularity) return [];

  const gangState = loadGangState(ns);
  if (gangState?.hasGang && gangState?.isBN2GangMode) {
    return [];
  }

  const ownedAugsSet = new Set(ownedAugs);
  const factionsNeedingRep: FactionName[] = [];
  const gangFaction = getGangFactionName(ns);

  for (const faction of playerFactions) {
    if (gangFaction && faction === gangFaction) continue;

    try {
      const factionAugs = ns.singularity.getAugmentationsFromFaction(
        faction as FactionName,
      );
      let maxRepNeeded = 0;

      for (const aug of factionAugs) {
        if (aug !== "NeuroFlux Governor" && !ownedAugsSet.has(aug)) {
          const req = ns.singularity.getAugmentationRepReq(aug);
          if (req > maxRepNeeded) maxRepNeeded = req;
        }
      }

      const currentRep = ns.singularity.getFactionRep(faction as FactionName);
      if (currentRep < maxRepNeeded) {
        factionsNeedingRep.push(faction as FactionName);
      }
    } catch {
      continue;
    }
  }
  return factionsNeedingRep;
}

export function determineSleeveMode(
  stats: SleevePerson,
  options?: SleeveOptions,
  factionsNeedingRep: FactionName[] = [],
  unlockStatus?: SleeveGangUnlockStatus,
): SleeveMode {
  if (stats.shock > 0) return "RECOVERY";
  if (stats.sync < 100) return "SYNCHRO";

  if (options?.globalMode) return options.globalMode;
  if (options?.strategy === "CRIME" || options?.strategy === "KILLS")
    return "CRIME";
  if (options?.strategy === "TRAIN") return "TRAIN";
  if (options?.strategy === "UNI") return "UNI";

  if (unlockStatus?.shouldGrindKarma) {
    return "CRIME";
  }

  if (factionsNeedingRep.length > 0) return "FACTION";

  return "COMPANY";
}

export function manageAllSleeves(
  ns: NS,
  p: Player,
  options: SleeveOptions | undefined,
  ownedAugs: string[],
  factionsNeedingRep: FactionName[],
  logger: Logger,
  addLocalLog: (msg: string) => void,
): string {
  const numSleeves = ns.sleeve.getNumSleeves();
  if (numSleeves === 0) return "Keine";

  const unlockStatus = checkSleeveGangStatus(ns);

  const sleeves: SleeveData[] = Array.from({ length: numSleeves }, (_, i) => ({
    index: i,
    stats: ns.sleeve.getSleeve(i),
    task: ns.sleeve.getTask(i),
  }));

  let totalShock = 0;
  let totalSync = 0;
  let activeWorkers = 0;
  let currentMoney = p.money;

  // 💡 Zustand aller Klon-Tasks nachhalten
  const currentTasks: (SleeveTask | null)[] = sleeves.map((s) => s.task);

  for (const { stats, task } of sleeves) {
    totalShock += stats.shock;
    totalSync += stats.sync;
    if (task) activeWorkers++;
  }

  for (const sleeve of sleeves) {
    const mode = determineSleeveMode(
      sleeve.stats,
      options,
      factionsNeedingRep,
      unlockStatus,
    );

    // 💡 Dynamisch ermitteln, was von ALLEN ANDEREN Klons (j !== sleeve.index) belegt ist
    const occupiedFactions: FactionName[] = [];
    const occupiedCompanies: CompanyName[] = [];

    for (let j = 0; j < numSleeves; j++) {
      if (j === sleeve.index) continue; // Den eigenen Klon überspringen
      const t = currentTasks[j];
      if (t?.type === "FACTION" && t.factionName) {
        if (!occupiedFactions.includes(t.factionName as FactionName)) {
          occupiedFactions.push(t.factionName as FactionName);
        }
      }
      if (t?.type === "COMPANY" && t.companyName) {
        if (!occupiedCompanies.includes(t.companyName as CompanyName)) {
          occupiedCompanies.push(t.companyName as CompanyName);
        }
      }
    }

    currentMoney = manageSingleSleeve(
      ns,
      sleeve.index,
      mode,
      sleeve.stats,
      currentTasks[sleeve.index],
      options,
      factionsNeedingRep,
      occupiedFactions,
      occupiedCompanies,
      p,
      currentMoney,
      logger,
      addLocalLog,
    );

    // 💡 Task nach der Zuweisung direkt aus dem Spielstand aktualisieren
    currentTasks[sleeve.index] = ns.sleeve.getTask(sleeve.index);
  }

  const avgShock = totalShock / numSleeves;
  const avgSync = totalSync / numSleeves;

  if (avgShock > 0) return `Shock: ${avgShock.toFixed(1)}%`;
  if (avgSync < 100) return `Sync: ${avgSync.toFixed(1)}%`;
  if (unlockStatus.shouldGrindKarma) {
    return `Karma: ${ns.heart.break().toFixed(0)}/-54k`;
  }
  return `${activeWorkers}/${numSleeves} Aktiv`;
}

export function manageSingleSleeve(
  ns: NS,
  i: number,
  mode: SleeveMode,
  stats: SleevePerson,
  currentTask: SleeveTask | null,
  options: SleeveOptions | undefined,
  factionsNeedingRep: FactionName[],
  occupiedFactions: FactionName[],
  occupiedCompanies: CompanyName[],
  p: Player,
  currentMoney: number,
  logger: Logger,
  addLocalLog: (msg: string) => void,
): number {
  let updatedMoney = currentMoney;

  switch (mode) {
    case "RECOVERY":
      if (currentTask?.type !== "RECOVERY") {
        ns.sleeve.setToShockRecovery(i);
        const msg = `💔 Klon #${i} geht in Schock-Therapie.`;
        logger.info(msg);
        addLocalLog(msg);
      }
      break;

    case "SYNCHRO":
      if (currentTask?.type !== "SYNCHRO") {
        ns.sleeve.setToSynchronize(i);
        const msg = `⚡ Klon #${i} startet Synchronisation.`;
        logger.info(msg);
        addLocalLog(msg);
      }
      break;

    case "TRAIN": {
      const volResult = ensureVolhaven(ns, i, stats, updatedMoney);
      updatedMoney = volResult.updatedMoney;
      const gymName = getGymForCity(volResult.currentCity);
      const uniName = getUniForCity(volResult.currentCity);

      const lowestCombatStat = COMBAT_STATS.reduce((a, b) =>
        stats.skills[a] < stats.skills[b] ? a : b,
      );

      if (stats.skills.hacking < 200) {
        if (
          currentTask?.type !== "CLASS" ||
          currentTask.classType !== "Algorithms" ||
          currentTask.location !== uniName
        ) {
          if (ns.sleeve.setToUniversityCourse(i, uniName, "Algorithms")) {
            const msg = `🎓 Klon #${i}: Lernt Algorithms an der ${uniName}.`;
            logger.info(msg);
            addLocalLog(msg);
          }
        }
      } else {
        const targetGymStat = GYM_STAT_MAP[lowestCombatStat];
        if (
          currentTask?.type !== "CLASS" ||
          currentTask.classType !== targetGymStat ||
          currentTask.location !== gymName
        ) {
          if (ns.sleeve.setToGymWorkout(i, gymName, targetGymStat)) {
            const msg = `🏋️ Klon #${i}: Trainiert ${targetGymStat} im ${gymName}.`;
            logger.info(msg);
            addLocalLog(msg);
          }
        }
      }
      break;
    }

    case "UNI": {
      const volResult = ensureVolhaven(ns, i, stats, updatedMoney);
      updatedMoney = volResult.updatedMoney;
      const uniName = getUniForCity(volResult.currentCity);

      let courseName: "Algorithms" | "Leadership" = "Algorithms";
      let statLabel = "Hacking";

      if (stats.skills.hacking >= 200 && stats.skills.charisma < 200) {
        courseName = "Leadership";
        statLabel = "Charisma";
      }

      if (
        currentTask?.type !== "CLASS" ||
        currentTask.classType !== courseName ||
        currentTask.location !== uniName
      ) {
        if (ns.sleeve.setToUniversityCourse(i, uniName, courseName)) {
          const msg = `🎓 Klon #${i}: Studiert ${courseName} (${statLabel}) an der ${uniName}.`;
          logger.info(msg);
          addLocalLog(msg);
        }
      }
      break;
    }

    case "CRIME":
      updatedMoney = executeFallbackCrime(
        ns,
        i,
        stats,
        currentTask,
        updatedMoney,
        logger,
        addLocalLog,
      );
      break;

    case "FACTION":
      if (
        tryAssignFactionWork(
          ns,
          i,
          stats,
          currentTask,
          options,
          factionsNeedingRep,
          occupiedFactions,
          logger,
          addLocalLog,
        )
      ) {
        return updatedMoney;
      }
      if (
        tryAssignCompanyWork(
          ns,
          i,
          stats,
          currentTask,
          options,
          occupiedCompanies,
          p,
          updatedMoney,
          logger,
          addLocalLog,
        ).success
      ) {
        return updatedMoney;
      }
      updatedMoney = executeFallbackCrime(
        ns,
        i,
        stats,
        currentTask,
        updatedMoney,
        logger,
        addLocalLog,
      );
      break;

    case "COMPANY":
      const compResult = tryAssignCompanyWork(
        ns,
        i,
        stats,
        currentTask,
        options,
        occupiedCompanies,
        p,
        updatedMoney,
        logger,
        addLocalLog,
      );
      updatedMoney = compResult.updatedMoney;
      if (compResult.success) return updatedMoney;

      updatedMoney = executeFallbackCrime(
        ns,
        i,
        stats,
        currentTask,
        updatedMoney,
        logger,
        addLocalLog,
      );
      break;

    default:
      updatedMoney = executeFallbackCrime(
        ns,
        i,
        stats,
        currentTask,
        updatedMoney,
        logger,
        addLocalLog,
      );
      break;
  }

  return updatedMoney;
}

function tryAssignFactionWork(
  ns: NS,
  i: number,
  stats: SleevePerson,
  currentTask: SleeveTask | null,
  options: SleeveOptions | undefined,
  factionsNeedingRep: FactionName[],
  occupiedFactions: FactionName[],
  logger: Logger,
  addLocalLog: (msg: string) => void,
): boolean {
  let targetFaction: FactionName | null = null;
  const gangFaction = getGangFactionName(ns);

  if (currentTask?.type === "FACTION") {
    const currentFaction = currentTask.factionName as FactionName;
    if (
      factionsNeedingRep.includes(currentFaction) &&
      currentFaction !== gangFaction &&
      !occupiedFactions.includes(currentFaction)
    ) {
      targetFaction = currentFaction;
    }
  }

  if (!targetFaction) {
    const availableFactions = factionsNeedingRep.filter(
      (f: FactionName) => !occupiedFactions.includes(f) && f !== gangFaction,
    );
    if (availableFactions.length > 0) {
      if (
        i === 0 &&
        options?.targetFaction &&
        availableFactions.includes(options.targetFaction as FactionName)
      ) {
        targetFaction = options.targetFaction as FactionName;
      } else {
        targetFaction = availableFactions[0];
      }
    }
  }

  if (!targetFaction) return false;

  const minRequiredStat = options?.targetStat || 0;
  const lowestStatName = COMBAT_STATS.reduce((a, b) =>
    stats.skills[a] < stats.skills[b] ? a : b,
  );
  const lowestSleeveCombatStat = stats.skills[lowestStatName];

  if (minRequiredStat > 0 && lowestSleeveCombatStat < minRequiredStat) {
    const gymName = getGymForCity(stats.city);
    const targetGymStat = GYM_STAT_MAP[lowestStatName];

    if (
      currentTask?.type !== "CLASS" ||
      currentTask.classType !== targetGymStat ||
      currentTask.location !== gymName
    ) {
      if (ns.sleeve.setToGymWorkout(i, gymName, targetGymStat)) {
        const msg = `🏋️ Klon #${i}: Bootcamp für ${targetFaction} -> ${targetGymStat} (Ziel: ${minRequiredStat}).`;
        logger.info(msg);
        addLocalLog(msg);
      }
    }
    return true;
  }

  if (
    currentTask?.type === "FACTION" &&
    currentTask.factionName === targetFaction
  ) {
    if (!occupiedFactions.includes(targetFaction)) {
      occupiedFactions.push(targetFaction);
    }
    return true;
  }

  const workTypes: FactionWorkType[] = ["hacking", "field", "security"];
  for (const work of workTypes) {
    try {
      if (ns.sleeve.setToFactionWork(i, targetFaction, work)) {
        const msg = `🤝 Klon #${i} arbeitet nun für Faction '${targetFaction}' (${work}).`;
        logger.info(msg);
        addLocalLog(msg);
        if (!occupiedFactions.includes(targetFaction)) {
          occupiedFactions.push(targetFaction);
        }
        return true;
      }
    } catch {
      /* Nächste Arbeitsart */
    }
  }

  return false;
}

function tryAssignCompanyWork(
  ns: NS,
  i: number,
  stats: SleevePerson,
  currentTask: SleeveTask | null,
  options: SleeveOptions | undefined,
  occupiedCompanies: CompanyName[],
  p: Player,
  currentMoney: number,
  logger: Logger,
  addLocalLog: (msg: string) => void,
): { success: boolean; updatedMoney: number } {
  if (options?.strategy === "MONEY" || !ns.singularity) {
    return { success: false, updatedMoney: currentMoney };
  }

  const companyList = Object.values(MEGACORPS);
  const employedCorps = Object.keys(p.jobs).filter((job) =>
    companyList.includes(job as CompanyName),
  ) as CompanyName[];

  if (employedCorps.length === 0) {
    return { success: false, updatedMoney: currentMoney };
  }

  let targetCorp: CompanyName | null = null;

  if (currentTask?.type === "COMPANY") {
    const currentCorp = currentTask.companyName as CompanyName;
    // 💡 Prüfen, ob die Firma nicht inzwischen von einem anderen Klon besetzt wurde
    if (
      employedCorps.includes(currentCorp) &&
      !occupiedCompanies.includes(currentCorp)
    ) {
      const req = currentCorp === "Fulcrum Technologies" ? 400_000 : 200_000;
      if (ns.singularity.getCompanyRep(currentCorp) < req) {
        targetCorp = currentCorp;
      }
    }
  }

  if (!targetCorp) {
    const availableCorps = employedCorps.filter((c) => {
      if (occupiedCompanies.includes(c)) return false;
      const req = c === "Fulcrum Technologies" ? 400_000 : 200_000;
      return ns.singularity.getCompanyRep(c) < req;
    });

    if (availableCorps.length > 0) {
      const preferredCorp = employedCorps[i % employedCorps.length];
      targetCorp = availableCorps.includes(preferredCorp)
        ? preferredCorp
        : availableCorps[0];
    }
  }

  if (!targetCorp) return { success: false, updatedMoney: currentMoney };

  const targetStatThreshold = 300;
  const volResult = ensureVolhaven(ns, i, stats, currentMoney);
  let updatedMoney = volResult.updatedMoney;
  const bestUniversity = getUniForCity(volResult.currentCity);

  if (stats.skills.hacking < targetStatThreshold) {
    if (
      currentTask?.type === "CLASS" &&
      currentTask.classType === "Algorithms" &&
      currentTask.location === bestUniversity
    ) {
      return { success: true, updatedMoney };
    }
    if (ns.sleeve.setToUniversityCourse(i, bestUniversity, "Algorithms")) {
      const msg = `🎓 Klon #${i} lernt Algorithms an der ${bestUniversity} (für ${targetCorp}).`;
      logger.info(msg);
      addLocalLog(msg);
      return { success: true, updatedMoney };
    }
  }

  if (stats.skills.charisma < targetStatThreshold) {
    if (
      currentTask?.type === "CLASS" &&
      currentTask.classType === "Leadership" &&
      currentTask.location === bestUniversity
    ) {
      return { success: true, updatedMoney };
    }
    if (ns.sleeve.setToUniversityCourse(i, bestUniversity, "Leadership")) {
      const msg = `🎓 Klon #${i} lernt Leadership an der ${bestUniversity} (für ${targetCorp}).`;
      logger.info(msg);
      addLocalLog(msg);
      return { success: true, updatedMoney };
    }
  }

  if (
    currentTask?.type === "COMPANY" &&
    currentTask.companyName === targetCorp
  ) {
    if (!occupiedCompanies.includes(targetCorp)) {
      occupiedCompanies.push(targetCorp);
    }
    return { success: true, updatedMoney };
  }

  if (ns.sleeve.setToCompanyWork(i, targetCorp)) {
    const msg = `🏢 Klon #${i} farmt jetzt Ruf bei ${targetCorp}.`;
    logger.info(msg);
    addLocalLog(msg);
    if (!occupiedCompanies.includes(targetCorp)) {
      occupiedCompanies.push(targetCorp);
    }
    return { success: true, updatedMoney };
  }

  return { success: false, updatedMoney };
}

function executeFallbackCrime(
  ns: NS,
  i: number,
  stats: SleevePerson,
  currentTask: SleeveTask | null,
  currentMoney: number,
  logger: Logger,
  addLocalLog: (msg: string) => void,
): number {
  const status = checkSleeveGangStatus(ns);
  let targetCrime: CrimeType = "Mug";

  if (status.shouldGrindKarma) {
    targetCrime = getBestKarmaCrime(ns, i, stats);
  } else {
    targetCrime = getBestProfitOrStatCrime(ns, i, stats);
  }

  const chance = getSleeveCrimeChance(ns, targetCrime, stats);

  if (chance < 0.4) {
    const lowestStatName = COMBAT_STATS.reduce((a, b) =>
      stats.skills[a] < stats.skills[b] ? a : b,
    );
    const volResult = ensureVolhaven(ns, i, stats, currentMoney);
    const gymName = getGymForCity(volResult.currentCity);
    const targetGymStat = GYM_STAT_MAP[lowestStatName];

    let gymSuccess = false;
    if (
      currentTask?.type === "CLASS" &&
      currentTask.classType === targetGymStat &&
      currentTask.location === gymName
    ) {
      gymSuccess = true;
    } else {
      gymSuccess = ns.sleeve.setToGymWorkout(i, gymName, targetGymStat);
      if (gymSuccess) {
        const msg = `🏋️ Klon #${i}: Not-Bootcamp (${targetGymStat}, ${targetCrime} Chance: ${(chance * 100).toFixed(1)}%) im ${gymName}.`;
        logger.info(msg);
        addLocalLog(msg);
      }
    }

    if (gymSuccess) {
      return volResult.updatedMoney;
    }
  }

  const fallbackCrime = chance >= 0.4 ? targetCrime : "Mug";

  if (
    currentTask?.type === "CRIME" &&
    currentTask.crimeType === fallbackCrime
  ) {
    return currentMoney;
  }

  if (ns.sleeve.setToCommitCrime(i, fallbackCrime)) {
    const actualChance = getSleeveCrimeChance(ns, fallbackCrime, stats);
    const msg = `🔫 Klon #${i} begeht Verbrechen: ${fallbackCrime} (${(actualChance * 100).toFixed(1)}% Chance)`;
    logger.info(msg);
    addLocalLog(msg);
  }

  return currentMoney;
}

export function getBestKarmaCrime(
  ns: NS,
  sleeveIndex: number,
  stats: SleevePerson,
): CrimeType {
  let bestCrime: CrimeType = "Mug";
  let maxKarmaPerSecond = -1;

  for (const crime of ALL_CRIMES) {
    const chance = getSleeveCrimeChance(ns, crime, stats);
    if (chance < 0.15) continue;

    let karmaYield = CRIME_KARMA_MAP[crime] ?? 0.5;
    let timeInSeconds = 2;

    if (ns.singularity) {
      try {
        const statsObj = ns.singularity.getCrimeStats(crime);
        karmaYield = Math.abs(statsObj.karma);
        timeInSeconds = statsObj.time / 1000;
      } catch {
        /* Fallback auf Map */
      }
    }

    const karmaPerSecond = (karmaYield * chance) / timeInSeconds;
    if (karmaPerSecond > maxKarmaPerSecond) {
      maxKarmaPerSecond = karmaPerSecond;
      bestCrime = crime;
    }
  }

  return bestCrime;
}

export function getBestProfitOrStatCrime(
  ns: NS,
  sleeveIndex: number,
  stats: SleevePerson,
): CrimeType {
  let bestCrime: CrimeType = "Mug";
  let maxScore = -1;

  for (const crime of ALL_CRIMES) {
    const chance = getSleeveCrimeChance(ns, crime, stats);
    if (chance < 0.25) continue;

    let moneyYield = 10000;
    let timeInSeconds = 2;

    if (ns.singularity) {
      try {
        const statsObj = ns.singularity.getCrimeStats(crime);
        moneyYield = statsObj.money;
        timeInSeconds = statsObj.time / 1000;
      } catch {
        moneyYield = 10000;
      }
    }

    const moneyPerSec = (moneyYield * chance) / timeInSeconds;
    if (moneyPerSec > maxScore) {
      maxScore = moneyPerSec;
      bestCrime = crime;
    }
  }

  return bestCrime;
}
