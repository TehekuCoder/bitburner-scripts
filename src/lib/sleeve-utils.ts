import {
  NS,
  FactionName,
  FactionWorkType,
  CompanyName,
  SleevePerson,
  SleeveTask,
  Player,
} from "@ns";
import { Logger } from "lib/logger.js";
import { BotState, SleeveMode, SleeveData } from "lib/types.js";
import { MEGACORPS, COMBAT_STATS, STAT_MAP } from "lib/constants.js";

let lastShoppingScan = 0;
const SHOPPING_INTERVAL = 15000; // Augmentations-Einkauf nur alle 15 Sek.

export function getFactionsNeedingRep(
  ns: NS,
  playerFactions: string[],
  ownedAugs: string[],
): FactionName[] {
  // 🛡️ Guard: Singularity API verfügbar?
  if (!ns.singularity) return [];

  const ownedAugsSet = new Set(ownedAugs);
  const factionsNeedingRep: FactionName[] = [];

  for (const faction of playerFactions) {
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
  currentState: BotState | null,
  factionsNeedingRep: FactionName[],
): SleeveMode {
  if (stats.shock > 0) return "RECOVERY";
  if (stats.sync < 100) return "SYNCHRO";

  if (currentState?.sleeveGlobalMode) {
    return currentState.sleeveGlobalMode as SleeveMode;
  }

  if (
    currentState?.strategy === "CRIME" ||
    currentState?.strategy === "KILLS"
  ) {
    return "CRIME";
  }
  if (currentState?.strategy === "TRAIN") {
    return "TRAIN";
  }

  if (factionsNeedingRep.length > 0) {
    return "FACTION";
  }

  return "COMPANY";
}

export function manageAllSleeves(
  ns: NS,
  p: Player,
  currentState: BotState | null,
  ownedAugs: string[],
  factionsNeedingRep: FactionName[],
  logger: Logger,
  addLocalLog: (msg: string) => void,
): void {
  const numSleeves = ns.sleeve.getNumSleeves();

  if (numSleeves === 0) {
    if (currentState) currentState.sleeveProgress = "Keine";
    return;
  }

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

  // 1. Initialer Pre-Scan: Bereits aktive Factions und Companies erfassen
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

  if (currentState) {
    const avgShock = totalShock / numSleeves;
    const avgSync = totalSync / numSleeves;

    if (avgShock > 0) {
      currentState.sleeveProgress = `Shock: ${avgShock.toFixed(1)}%`;
    } else if (avgSync < 100) {
      currentState.sleeveProgress = `Sync: ${avgSync.toFixed(1)}%`;
    } else {
      currentState.sleeveProgress = `${activeWorkers}/${numSleeves} Aktiv`;
    }
  }

  // Einkauf gedrosselt ausführen
  const canShop = Date.now() - lastShoppingScan > SHOPPING_INTERVAL;

  for (const sleeve of sleeves) {
    if (canShop) {
      handleSleeveShopping(ns, sleeve.index, p, logger, addLocalLog);
    }

    const mode = determineSleeveMode(
      sleeve.stats,
      currentState,
      factionsNeedingRep,
    );

    manageSingleSleeve(
      ns,
      sleeve.index,
      mode,
      sleeve.stats,
      sleeve.task,
      currentState,
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
}

export function manageSingleSleeve(
  ns: NS,
  i: number,
  mode: SleeveMode,
  stats: SleevePerson,
  currentTask: SleeveTask | null,
  currentState: BotState | null,
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
        const msg = `💔 Klon #${i} geht in die Schock-Therapie.`;
        logger.info(msg);
        addLocalLog(msg);
      }
      break;

    case "SYNCHRO":
      if (currentTask?.type !== "SYNCHRO") {
        ns.sleeve.setToSynchronize(i);
        const msg = `⚡ Klon #${i} startet Gehirn-Synchronisation.`;
        logger.info(msg);
        addLocalLog(msg);
      }
      break;

    case "TRAIN": {
      const lowestStatName = COMBAT_STATS.reduce((a, b) =>
        stats.skills[a] < stats.skills[b] ? a : b,
      );
      const gymName = stats.city === "Volhaven" ? "Powerhouse Gym" : "Iron Gym";
      const targetGymStat = STAT_MAP[lowestStatName];
      if (
        currentTask?.type !== "CLASS" ||
        currentTask?.classType !== targetGymStat ||
        currentTask?.location !== gymName
      ) {
        ns.sleeve.setToGymWorkout(i, gymName, targetGymStat);
        const msg = `🏋️ Klon #${i}: Vorab-Bootcamp aktiv! Trainiert ${targetGymStat} im ${gymName}.`;
        logger.info(msg);
        addLocalLog(msg);
      }
      break;
    }

    case "CRIME":
      executeFallbackCrime(ns, i, currentTask, p, logger, addLocalLog);
      break;

    case "FACTION":
      if (
        tryAssignFactionWork(
          ns,
          i,
          stats,
          currentTask,
          currentState,
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
          currentState,
          occupiedCompanies,
          p,
          logger,
          addLocalLog,
        )
      ) {
        return;
      }
      executeFallbackCrime(ns, i, currentTask, p, logger, addLocalLog);
      break;

    case "COMPANY":
      if (
        tryAssignCompanyWork(
          ns,
          i,
          stats,
          currentTask,
          currentState,
          occupiedCompanies,
          p,
          logger,
          addLocalLog,
        )
      ) {
        return;
      }
      executeFallbackCrime(ns, i, currentTask, p, logger, addLocalLog);
      break;

    default:
      executeFallbackCrime(ns, i, currentTask, p, logger, addLocalLog);
      break;
  }
}

function tryAssignFactionWork(
  ns: NS,
  i: number,
  stats: SleevePerson,
  currentTask: SleeveTask | null,
  currentState: BotState | null,
  factionsNeedingRep: FactionName[],
  occupiedFactions: FactionName[],
  logger: Logger,
  addLocalLog: (msg: string) => void,
): boolean {
  let targetFaction: FactionName | null = null;

  if (currentTask?.type === "FACTION") {
    const currentFaction = currentTask.factionName as FactionName;
    if (factionsNeedingRep.includes(currentFaction)) {
      targetFaction = currentFaction;
    }
  }

  if (!targetFaction) {
    const availableFactions = factionsNeedingRep.filter(
      (f: FactionName) => !occupiedFactions.includes(f),
    );
    if (availableFactions.length > 0) {
      if (
        i === 0 &&
        currentState?.targetFaction &&
        availableFactions.includes(currentState.targetFaction as FactionName)
      ) {
        targetFaction = currentState.targetFaction as FactionName;
      } else {
        targetFaction = availableFactions[0];
      }
    }
  }

  if (!targetFaction) return false;

  const minRequiredStat = currentState?.targetStat || 0;
  const lowestStatName = COMBAT_STATS.reduce((a, b) =>
    stats.skills[a] < stats.skills[b] ? a : b,
  );
  const lowestSleeveCombatStat = stats.skills[lowestStatName];

  if (minRequiredStat > 0 && lowestSleeveCombatStat < minRequiredStat) {
    const gymName = stats.city === "Volhaven" ? "Powerhouse Gym" : "Iron Gym";
    const targetGymStat = STAT_MAP[lowestStatName];

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

    if (ns.sleeve.setToFactionWork(i, targetFaction, work)) {
      const msg = `🤝 Klon #${i} arbeitet nun für Faction '${targetFaction}' (${work}).`;
      logger.info(msg);
      addLocalLog(msg);
      if (!occupiedFactions.includes(targetFaction)) {
        occupiedFactions.push(targetFaction);
      }
      return true;
    }
  }

  return false;
}

function tryAssignCompanyWork(
  ns: NS,
  i: number,
  stats: SleevePerson,
  currentTask: SleeveTask | null,
  currentState: BotState | null,
  occupiedCompanies: CompanyName[],
  p: Player,
  logger: Logger,
  addLocalLog: (msg: string) => void,
): boolean {
  if (currentState?.strategy === "MONEY") return false;
  if (!ns.singularity) return false; // 🛡️ Guard: Singularity API erforderlich

  const companyList = Object.values(MEGACORPS);

  const employedCorps = Object.keys(p.jobs).filter((job) =>
    companyList.includes(job as CompanyName),
  ) as CompanyName[];

  if (employedCorps.length === 0) return false;

  let targetCorp: CompanyName | null = null;

  // 1. Ist dieser Klon bereits bei einer Firma beschäftigt, die noch Ruf braucht?
  if (currentTask?.type === "COMPANY") {
    const currentCorp = currentTask.companyName as CompanyName;
    if (employedCorps.includes(currentCorp)) {
      const req = currentCorp === "Fulcrum Technologies" ? 400_000 : 200_000;
      if (ns.singularity.getCompanyRep(currentCorp) < req) {
        targetCorp = currentCorp;
      }
    }
  }

  // 2. Falls nicht (oder Ziel erreicht), freie Firma suchen, die noch NIE belegt ist
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
  const targetCity = p.money >= 200_000 ? "Volhaven" : "Sector-12";
  const bestUniversity =
    targetCity === "Volhaven"
      ? "ZB Institute of Technology"
      : "Rothman University";

  if (
    (stats.skills.hacking < targetStatThreshold ||
      stats.skills.charisma < targetStatThreshold) &&
    stats.city !== targetCity &&
    p.money >= 200_000
  ) {
    if (ns.sleeve.travel(i, targetCity)) {
      const msg = `✈️ Klon #${i} reist nach ${targetCity} für Uni-Kurse.`;
      logger.info(msg);
      addLocalLog(msg);
    }
  }

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

function executeFallbackCrime(
  ns: NS,
  i: number,
  currentTask: SleeveTask | null,
  p: Player,
  logger: Logger,
  addLocalLog: (msg: string) => void,
): void {
  const targetCrime = ns.heart.break() > -54 ? "Homicide" : "Mug";

  if (currentTask?.type === "CRIME" && currentTask?.crimeType === targetCrime) {
    return;
  }

  ns.sleeve.setToCommitCrime(i, targetCrime);
  const msg = `🔫 Klon #${i} wechselt auf Fallback-Kriminalität: ${targetCrime}`;
  logger.warn(msg);
  addLocalLog(msg);
}
