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
import { SleeveMode, SleeveData, SleeveOptions } from "lib/types.js";
import { MEGACORPS, COMBAT_STATS, GYM_STAT_MAP } from "lib/constants.js";
import { loadGangState } from "/lib/state.js";

let lastShoppingScan = 0;
const SHOPPING_INTERVAL = 15000;
const TRAVEL_COST = 200_000;

/**
 * Hilfsfunktion: Versetzt einen Sleeve nach Volhaven, sofern genug Geld da ist.
 */
function ensureVolhaven(
  ns: NS,
  i: number,
  stats: SleevePerson,
  p: Player,
): boolean {
  if (stats.city === "Volhaven") return true;
  if (p.money >= TRAVEL_COST) {
    return ns.sleeve.travel(i, "Volhaven");
  }
  return false;
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
  if (options?.strategy === "UNI") return "UNI"; // 🎓 Neu: Schaltet Sleeves auf Studium um

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
  const occupiedFactions: FactionName[] = [];
  const occupiedCompanies: CompanyName[] = [];

  for (const { stats, task } of sleeves) {
    totalShock += stats.shock;
    totalSync += stats.sync;

    if (task) activeWorkers++;

    if (stats.shock === 0 && stats.sync === 100) {
      if (task?.type === "FACTION") {
        const fName = task.factionName as FactionName;
        if (
          factionsNeedingRep.includes(fName) &&
          !occupiedFactions.includes(fName)
        ) {
          occupiedFactions.push(fName);
        }
      } else if (task?.type === "COMPANY") {
        const cName = task.companyName as CompanyName;
        if (!occupiedCompanies.includes(cName)) {
          occupiedCompanies.push(cName);
        }
      }
    }
  }

  let sleeveProgress = "Inaktiv";
  const avgShock = totalShock / numSleeves;
  const avgSync = totalSync / numSleeves;

  if (avgShock > 0) {
    sleeveProgress = `Shock: ${avgShock.toFixed(1)}%`;
  } else if (avgSync < 100) {
    sleeveProgress = `Sync: ${avgSync.toFixed(1)}%`;
  } else {
    sleeveProgress = `${activeWorkers}/${numSleeves} Aktiv`;
  }

  const canShop = Date.now() - lastShoppingScan > SHOPPING_INTERVAL;

  for (const sleeve of sleeves) {
    if (canShop) {
      handleSleeveShopping(ns, sleeve.index, p, logger, addLocalLog);
    }

    const mode = determineSleeveMode(sleeve.stats, options, factionsNeedingRep);

    manageSingleSleeve(
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
      logger,
      addLocalLog,
    );
  }

  if (canShop) {
    lastShoppingScan = Date.now();
  }

  return sleeveProgress;
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
  logger: Logger,
  addLocalLog: (msg: string) => void,
): void {
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
      // 🎓/🏋️ TRAIN MODUS: Wählt die schwächste Skill-Gruppe (Combat vs Hacking vs Charisma)
      const inVolhaven = ensureVolhaven(ns, i, stats, p);
      const gymName = inVolhaven ? "Powerhouse Gym" : "Iron Gym";
      const uniName = inVolhaven
        ? "ZB Institute of Technology"
        : "Rothman University";

      const lowestCombatStat = COMBAT_STATS.reduce((a, b) =>
        stats.skills[a] < stats.skills[b] ? a : b,
      );

      // Falls Hacking unter 200 ist, lernt der Sleeve Hacking an der Uni
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
        // Sonst Combat-Gym
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
      // 🎓 DEDIZIERTER UNI MODUS
      const inVolhaven = ensureVolhaven(ns, i, stats, p);
      const uniName = inVolhaven
        ? "ZB Institute of Technology"
        : "Rothman University";

      // Dynamische Kurs-Wahl: Schaut ob Hacking oder Charisma trainiert werden soll
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
      executeFallbackCrime(ns, i, stats, currentTask, p, logger, addLocalLog);
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
        return;
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
          logger,
          addLocalLog,
        )
      ) {
        return;
      }
      executeFallbackCrime(ns, i, stats, currentTask, p, logger, addLocalLog);
      break;

    case "COMPANY":
      if (
        tryAssignCompanyWork(
          ns,
          i,
          stats,
          currentTask,
          options,
          occupiedCompanies,
          p,
          logger,
          addLocalLog,
        )
      ) {
        return;
      }
      executeFallbackCrime(ns, i, stats, currentTask, p, logger, addLocalLog);
      break;

    default:
      executeFallbackCrime(ns, i, stats, currentTask, p, logger, addLocalLog);
      break;
  }
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
      const msg = `🏋️ Klon #${i}: Live-Bootcamp für ${targetFaction} -> Trainiert ${targetGymStat} (Ziel: ${minRequiredStat}).`;
      logger.info(msg);
      addLocalLog(msg);
    }
    return true;
  }

  const workTypes: FactionWorkType[] = ["hacking", "field", "security"];
  for (const work of workTypes) {
    if (
      currentTask?.type === "FACTION" &&
      currentTask.factionName === targetFaction &&
      "factionWorkType" in currentTask &&
      currentTask.factionWorkType === work
    ) {
      return true;
    }

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
      /* Ignorieren & nächste Arbeitsart versuchen */
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
  logger: Logger,
  addLocalLog: (msg: string) => void,
): boolean {
  if (options?.strategy === "MONEY") return false;
  if (!ns.singularity) return false;

  const companyList = Object.values(MEGACORPS);
  const employedCorps = Object.keys(p.jobs).filter((job) =>
    companyList.includes(job as CompanyName),
  ) as CompanyName[];

  if (employedCorps.length === 0) return false;

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
      if (availableCorps.includes(preferredCorp)) {
        targetCorp = preferredCorp;
      } else {
        targetCorp = availableCorps[0];
      }
    }
  }

  if (!targetCorp) return false;

  if (
    currentTask?.type === "COMPANY" &&
    currentTask?.companyName === targetCorp
  ) {
    return true;
  }

  if (ns.sleeve.setToCompanyWork(i, targetCorp)) {
    const msg = `🏢 Klon #${i} farmt jetzt Ruf bei ${targetCorp}.`;
    logger.info(msg);
    addLocalLog(msg);
    if (!occupiedCompanies.includes(targetCorp)) {
      occupiedCompanies.push(targetCorp);
    }
    return true;
  }

  const targetStatThreshold = 300;
  const inVolhaven = ensureVolhaven(ns, i, stats, p);
  const bestUniversity = inVolhaven
    ? "ZB Institute of Technology"
    : "Rothman University";

  if (stats.skills.hacking < targetStatThreshold) {
    if (
      currentTask?.type === "CLASS" &&
      currentTask?.classType === "Algorithms" &&
      currentTask?.location === bestUniversity
    ) {
      return true;
    }
    if (ns.sleeve.setToUniversityCourse(i, bestUniversity, "Algorithms")) {
      const msg = `🎓 Klon #${i} lernt Algorithms an der ${bestUniversity} (Vorbereitung für ${targetCorp}).`;
      logger.info(msg);
      addLocalLog(msg);
      return true;
    }
  }

  if (stats.skills.charisma < targetStatThreshold) {
    if (
      currentTask?.type === "CLASS" &&
      currentTask?.classType === "Leadership" &&
      currentTask?.location === bestUniversity
    ) {
      return true;
    }
    if (ns.sleeve.setToUniversityCourse(i, bestUniversity, "Leadership")) {
      const msg = `🎓 Klon #${i} lernt Leadership an der ${bestUniversity} (Vorbereitung für ${targetCorp}).`;
      logger.info(msg);
      addLocalLog(msg);
      return true;
    }
  }

  return false;
}

function handleSleeveShopping(
  ns: NS,
  i: number,
  p: Player,
  logger: Logger,
  addLocalLog: (msg: string) => void,
): void {
  const BUDGET_MULTIPLIER = 10;
  try {
    const purchasableAugs = ns.sleeve.getSleevePurchasableAugs(i);
    if (purchasableAugs.length === 0) return;

    purchasableAugs.sort((a, b) => a.cost - b.cost);

    for (const aug of purchasableAugs) {
      if (p.money > aug.cost * BUDGET_MULTIPLIER) {
        if (ns.sleeve.purchaseSleeveAug(i, aug.name)) {
          const msg = `🛒 Klon #${i}: Augment erworben -> ${aug.name}`;
          logger.success(msg);
          addLocalLog(msg);
        }
      } else {
        break;
      }
    }
  } catch {
    /* Safe ignore */
  }
}

/**
 * Dynamisches Verbrechen:
 * 1. Schickt den Klon ins Gym, falls Combat-Stats < 35 sind (gleicht Stats automatisch an).
 * 2. Priorisiert Homicide für den Karma-Grind (Karma > -54000).
 * 3. Nutzt "Mug People" als verlässlichen Standard-Fallback.
 */
function executeFallbackCrime(
  ns: NS,
  i: number,
  stats: SleevePerson,
  currentTask: SleeveTask | null,
  p: Player,
  logger: Logger,
  addLocalLog: (msg: string) => void,
): void {
  const gangState = loadGangState(ns);
  const hasGang = gangState?.hasGang || (ns.gang && ns.gang.inGang());

  // 1. Schwächsten Combat-Stat ermitteln
  const lowestStatName = COMBAT_STATS.reduce((a, b) =>
    stats.skills[a] < stats.skills[b] ? a : b,
  );
  const avgCombat =
    (stats.skills.strength +
      stats.skills.defense +
      stats.skills.dexterity +
      stats.skills.agility) / 4;

  const MIN_COMBAT_FOR_HOMICIDE = 35; // Ab ~35 Combat-Stats wird Homicide verlässlich

  // 🎯 STEP 1: Combat-Bootcamp (Gleicht Stats automatisch ab)
  // Falls die Combat-Stats noch zu niedrig für verlässliches Homicide sind -> Gym!
  if (!hasGang && ns.heart.break() > -54000 && avgCombat < MIN_COMBAT_FOR_HOMICIDE) {
    const inVolhaven = ensureVolhaven(ns, i, stats, p);
    const gymName = inVolhaven ? "Powerhouse Gym" : "Iron Gym";
    const targetGymStat = GYM_STAT_MAP[lowestStatName];

    if (
      currentTask?.type !== "CLASS" ||
      currentTask?.classType !== targetGymStat ||
      currentTask?.location !== gymName
    ) {
      ns.sleeve.setToGymWorkout(i, gymName, targetGymStat);
      const msg = `🏋️ Klon #${i}: Combat-Bootcamp (${targetGymStat} ${stats.skills[lowestStatName]}/${MIN_COMBAT_FOR_HOMICIDE}) im ${gymName}.`;
      logger.info(msg);
      addLocalLog(msg);
    }
    return;
  }

  // 🎯 STEP 2: Verbrechen-Wahl
  let targetCrime: CrimeType = "Mug"; // Standard-Fallback anstelle von "Deal Drugs"

  // Solange kein Gang-Beitritt erfolgt ist und Karma fehlt -> Homicide grind
  if (!hasGang && ns.heart.break() > -54000) {
    targetCrime = "Homicide";
  }

  // 🎯 STEP 3: Ausführung
  if (currentTask?.type === "CRIME" && currentTask?.crimeType === targetCrime) {
    return;
  }

  if (ns.sleeve.setToCommitCrime(i, targetCrime)) {
    const msg = `🔫 Klon #${i} wechselt auf Crime: ${targetCrime}`;
    logger.info(msg);
    addLocalLog(msg);
  }
}