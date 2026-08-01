import {
  NS,
  FactionName,
  FactionWorkType,
  CompanyName,
  SleevePerson,
  SleeveTask,
  Player,
  CrimeType,
} from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { MEGACORPS, COMBAT_STATS, GYM_STAT_MAP } from "lib/constants.js";
import { loadGangState } from "/lib/state.js";
import { SleeveOptions, SleeveMode, SleeveData } from "./types/sleeves.js";
import { hasSingularity } from "./utils.js";

const TRAVEL_COST = 200_000;

function ensureVolhaven(
  ns: NS,
  i: number,
  stats: SleevePerson,
  currentMoney: number,
): { success: boolean; updatedMoney: number } {
  if (stats.city === "Volhaven") return { success: true, updatedMoney: currentMoney };
  if (currentMoney >= TRAVEL_COST) {
    if (ns.sleeve.travel(i, "Volhaven")) {
      return { success: true, updatedMoney: currentMoney - TRAVEL_COST };
    }
  }
  return { success: false, updatedMoney: currentMoney };
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
): SleeveMode {
  if (stats.shock > 0) return "RECOVERY";
  if (stats.sync < 100) return "SYNCHRO";

  if (options?.globalMode) return options.globalMode;
  if (options?.strategy === "CRIME" || options?.strategy === "KILLS")
    return "CRIME";
  if (options?.strategy === "TRAIN") return "TRAIN";
  if (options?.strategy === "UNI") return "UNI";

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

  const sleeves: SleeveData[] = Array.from({ length: numSleeves }, (_, i) => ({
    index: i,
    stats: ns.sleeve.getSleeve(i),
    task: ns.sleeve.getTask(i),
  }));

  let totalShock = 0;
  let totalSync = 0;
  let activeWorkers = 0;
  let currentMoney = p.money;

  const occupiedFactions: FactionName[] = [];
  const occupiedCompanies: CompanyName[] = [];

  for (const { stats, task } of sleeves) {
    totalShock += stats.shock;
    totalSync += stats.sync;
    if (task) activeWorkers++;
  }

  for (const sleeve of sleeves) {
    const mode = determineSleeveMode(sleeve.stats, options, factionsNeedingRep);

    currentMoney = manageSingleSleeve(
      ns,
      sleeve.index,
      mode,
      sleeve.stats,
      sleeve.task,
      options,
      factionsNeedingRep,
      occupiedFactions,
      occupiedCompanies,
      p,
      currentMoney,
      logger,
      addLocalLog,
    );
  }

  const avgShock = totalShock / numSleeves;
  const avgSync = totalSync / numSleeves;

  if (avgShock > 0) return `Shock: ${avgShock.toFixed(1)}%`;
  if (avgSync < 100) return `Sync: ${avgSync.toFixed(1)}%`;
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
      const gymName = volResult.success ? "Powerhouse Gym" : "Iron Gym";
      const uniName = volResult.success
        ? "ZB Institute of Technology"
        : "Rothman University";

      const lowestCombatStat = COMBAT_STATS.reduce((a, b) =>
        stats.skills[a] < stats.skills[b] ? a : b,
      );

      if (stats.skills.hacking < 200) {
        if (
          currentTask?.type !== "CLASS" ||
          currentTask?.classType !== "Algorithms" ||
          currentTask?.location !== uniName
        ) {
          ns.sleeve.setToUniversityCourse(i, uniName, "Algorithms");
          const msg = `🎓 Klon #${i}: Lernt Algorithms an der ${uniName}.`;
          logger.info(msg);
          addLocalLog(msg);
        }
      } else {
        const targetGymStat = GYM_STAT_MAP[lowestCombatStat];
        if (
          currentTask?.type !== "CLASS" ||
          currentTask?.classType !== targetGymStat ||
          currentTask?.location !== gymName
        ) {
          ns.sleeve.setToGymWorkout(i, gymName, targetGymStat);
          const msg = `🏋️ Klon #${i}: Trainiert ${targetGymStat} im ${gymName}.`;
          logger.info(msg);
          addLocalLog(msg);
        }
      }
      break;
    }

    case "UNI": {
      const volResult = ensureVolhaven(ns, i, stats, updatedMoney);
      updatedMoney = volResult.updatedMoney;
      const uniName = volResult.success
        ? "ZB Institute of Technology"
        : "Rothman University";

      let courseName: "Algorithms" | "Leadership" = "Algorithms";
      let statLabel = "Hacking";

      if (stats.skills.hacking >= 200 && stats.skills.charisma < 200) {
        courseName = "Leadership";
        statLabel = "Charisma";
      }

      if (
        currentTask?.type !== "CLASS" ||
        currentTask?.classType !== courseName ||
        currentTask?.location !== uniName
      ) {
        ns.sleeve.setToUniversityCourse(i, uniName, courseName);
        const msg = `🎓 Klon #${i}: Studiert ${courseName} (${statLabel}) an der ${uniName}.`;
        logger.info(msg);
        addLocalLog(msg);
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
      currentFaction !== gangFaction
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
    const gymName = stats.city === "Volhaven" ? "Powerhouse Gym" : "Iron Gym";
    const targetGymStat = GYM_STAT_MAP[lowestStatName];

    if (
      currentTask?.type !== "CLASS" ||
      currentTask?.classType !== targetGymStat ||
      currentTask?.location !== gymName
    ) {
      ns.sleeve.setToGymWorkout(i, gymName, targetGymStat);
      const msg = `🏋️ Klon #${i}: Bootcamp für ${targetFaction} -> ${targetGymStat} (Ziel: ${minRequiredStat}).`;
      logger.info(msg);
      addLocalLog(msg);
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
    if (employedCorps.includes(currentCorp)) {
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
  const bestUniversity = volResult.success
    ? "ZB Institute of Technology"
    : "Rothman University";

  if (stats.skills.hacking < targetStatThreshold) {
    if (
      currentTask?.type === "CLASS" &&
      currentTask?.classType === "Algorithms" &&
      currentTask?.location === bestUniversity
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
      currentTask?.classType === "Leadership" &&
      currentTask?.location === bestUniversity
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
    currentTask?.companyName === targetCorp
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
  const gangState = loadGangState(ns);
  const hasGang = gangState?.hasGang || (ns.gang && ns.gang.inGang());
  let targetCrime: CrimeType = "Mug";

  if (!hasGang && ns.heart.break() > -54000) {
    targetCrime = getBestKarmaCrime(ns, stats);
  } else {
    targetCrime = "Homicide";
  }

  const chance = calculateSleeveCrimeChance(ns, stats, targetCrime);

  if (chance < 0.4) {
    const lowestStatName = COMBAT_STATS.reduce((a, b) =>
      stats.skills[a] < stats.skills[b] ? a : b,
    );
    const volResult = ensureVolhaven(ns, i, stats, currentMoney);
    const gymName = volResult.success ? "Powerhouse Gym" : "Iron Gym";
    const targetGymStat = GYM_STAT_MAP[lowestStatName];

    if (
      currentTask?.type !== "CLASS" ||
      currentTask?.classType !== targetGymStat ||
      currentTask?.location !== gymName
    ) {
      ns.sleeve.setToGymWorkout(i, gymName, targetGymStat);
      const msg = `🏋️ Klon #${i}: Not-Bootcamp (${targetGymStat}, ${targetCrime} Chance: ${(chance * 100).toFixed(1)}%) im ${gymName}.`;
      logger.info(msg);
      addLocalLog(msg);
    }
    return volResult.updatedMoney;
  }

  if (currentTask?.type === "CRIME" && currentTask?.crimeType === targetCrime) {
    return currentMoney;
  }

  if (ns.sleeve.setToCommitCrime(i, targetCrime)) {
    const msg = `🔫 Klon #${i} optimiert Karma mit: ${targetCrime} (${(chance * 100).toFixed(1)}% Chance)`;
    logger.info(msg);
    addLocalLog(msg);
  }

  return currentMoney;
}

export function calculateSleeveCrimeChance(
  ns: NS,
  stats: SleevePerson,
  crime: CrimeType,
): number {
  const avgCombat =
    (stats.skills.strength +
      stats.skills.defense +
      stats.skills.dexterity +
      stats.skills.agility) / 4;

  if (!hasSingularity(ns)) {
    switch (crime) {
      case "Mug":
        return Math.min(avgCombat / 20, 1.0);
      case "Homicide":
        return Math.min(avgCombat / 75, 1.0);
      default:
        return avgCombat >= 50 ? 0.75 : 0.25;
    }
  }

  const crimeStats = ns.singularity.getCrimeStats(crime);
  const s = stats.skills;

  const weightedStatSum =
    crimeStats.hacking_success_weight * s.hacking +
    crimeStats.strength_success_weight * s.strength +
    crimeStats.defense_success_weight * s.defense +
    crimeStats.dexterity_success_weight * s.dexterity +
    crimeStats.agility_success_weight * s.agility +
    crimeStats.charisma_success_weight * s.charisma;

  const chance = weightedStatSum / (975 * crimeStats.difficulty);
  return Math.min(Math.max(chance, 0), 1);
}

export function getBestKarmaCrime(ns: NS, stats: SleevePerson): CrimeType {
  const avgCombat =
    (stats.skills.strength +
      stats.skills.defense +
      stats.skills.dexterity +
      stats.skills.agility) / 4;

  if (!hasSingularity(ns)) {
    return avgCombat >= 35 ? "Homicide" : "Mug";
  }

  const crimesToEvaluate: CrimeType[] = [
    "Mug",
    "Homicide",
    "Larceny",
    "Assassination",
    "Heist",
  ];

  let bestCrime: CrimeType = "Mug";
  let maxKarmaPerSecond = -1;

  for (const crime of crimesToEvaluate) {
    const statsObj = ns.singularity.getCrimeStats(crime);
    const chance = calculateSleeveCrimeChance(ns, stats, crime);

    if (chance < 0.15) continue;

    const karmaYield = Math.abs(statsObj.karma);
    const timeInSeconds = statsObj.time / 1000;
    const karmaPerSecond = (karmaYield * chance) / timeInSeconds;

    if (karmaPerSecond > maxKarmaPerSecond) {
      maxKarmaPerSecond = karmaPerSecond;
      bestCrime = crime;
    }
  }

  return bestCrime;
}