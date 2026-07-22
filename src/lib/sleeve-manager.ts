import { NS, FactionName, FactionWorkType, CompanyName, SleevePerson, SleeveTask, Player} from "@ns";
import { Logger } from "../core/logger.js";
import { BotState, SleeveMode } from "/core/types.js";
import { COMBAT_KEYS, GYM_STAT_MAP } from "./constants.js";

export const MEGACORPS: CompanyName[] = [
  "ECorp",
  "MegaCorp",
  "KuaiGong International",
  "Four Sigma",
  "NWO",
  "Blade Industries",
  "OmniTek Incorporated",
  "Bachman & Associates",
  "Clarke Incorporated",
  "Fulcrum Technologies",
];

interface SleeveData {
  index: number;
  stats: SleevePerson;
  task: SleeveTask | null;
}

/**
 * Ermittelt, bei welchen Fraktionen noch Ruf für fehlende Augmentations benötigt wird.
 */
export function getFactionsNeedingRep(
  ns: NS,
  playerFactions: string[],
  ownedAugs: string[],
): FactionName[] {
  const ownedAugsSet = new Set(ownedAugs);
  const factionsNeedingRep: FactionName[] = [];

  for (const faction of playerFactions) {
    try {
      const factionAugs = ns.singularity.getAugmentationsFromFaction(faction as FactionName);
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

/**
 * Entscheidet rein strategisch, in welchem Modus sich ein Sleeve befinden sollte.
 */
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

  if (currentState?.strategy === "CRIME" || currentState?.strategy === "KILLS") {
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

/**
 * Kern-Entscheidungs-Engine für alle Sleeves (Orchestrator).
 */
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

  // Single-Pass Data Fetching (Reduziert API-Aufrufe)
  const sleeves: SleeveData[] = Array.from({ length: numSleeves }, (_, i) => ({
    index: i,
    stats: ns.sleeve.getSleeve(i),
    task: ns.sleeve.getTask(i),
  }));

  let totalShock = 0;
  let totalSync = 0;
  let activeWorkers = 0;
  const occupiedFactions: FactionName[] = [];

  for (const { stats, task } of sleeves) {
    totalShock += stats.shock;
    totalSync += stats.sync;

    if (task) activeWorkers++;

    if (stats.shock === 0 && stats.sync === 100 && task?.type === "FACTION") {
      const fName = task.factionName as FactionName;
      if (factionsNeedingRep.includes(fName) && !occupiedFactions.includes(fName)) {
        occupiedFactions.push(fName);
      }
    }
  }

  // Dashboard Progress Update
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

  // Individuelle Zuweisung
  for (const sleeve of sleeves) {
    handleSleeveShopping(ns, sleeve.index, p, logger, addLocalLog);

    const mode = determineSleeveMode(sleeve.stats, currentState, factionsNeedingRep);

    manageSingleSleeve(
      ns,
      sleeve.index,
      mode,
      sleeve.stats,
      sleeve.task,
      currentState,
      factionsNeedingRep,
      occupiedFactions,
      p,
      logger,
      addLocalLog,
    );
  }
}

/**
 * Führt die Zuweisungs-Logik für einen einzelnen Klon aus.
 */
export function manageSingleSleeve(
  ns: NS,
  i: number,
  mode: SleeveMode,
  stats: SleevePerson,
  currentTask: SleeveTask | null,
  currentState: BotState | null,
  factionsNeedingRep: FactionName[],
  occupiedFactions: FactionName[],
  p: Player,
  logger: Logger,
  addLocalLog: (msg: string) => void,
): void {
  const minRequiredStat = currentState?.targetStat || 0;
  
  const lowestStatName = COMBAT_KEYS.reduce((a, b) =>
    stats.skills[a] < stats.skills[b] ? a : b,
  );
  const lowestSleeveCombatStat = stats.skills[lowestStatName];

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
      const gymName = stats.city === "Volhaven" ? "Powerhouse Gym" : "Iron Gym";
      const targetGymStat = GYM_STAT_MAP[lowestStatName];
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

    case "FACTION": {
      let targetFaction: FactionName | null = null;
      if (currentTask?.type === "FACTION") {
        const currentFaction = currentTask.factionName as FactionName;
        if (factionsNeedingRep.includes(currentFaction)) {
          targetFaction = currentFaction;
        }
      }

      if (!targetFaction) {
        const availableFactions = factionsNeedingRep.filter((f) => !occupiedFactions.includes(f));
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

      if (targetFaction) {
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
          return;
        }

        const workTypes: FactionWorkType[] = ["hacking", "field", "security"];
        let assigned = false;
        for (const work of workTypes) {
          if (
            currentTask?.type === "FACTION" &&
            currentTask.factionName === targetFaction &&
            (currentTask as any).factionWorkType === work
          ) {
            assigned = true;
            break;
          }

          if (ns.sleeve.setToFactionWork(i, targetFaction, work)) {
            assigned = true;
            const msg = `🤝 Klon #${i} arbeitet nun für Faction '${targetFaction}' (${work}).`;
            logger.info(msg);
            addLocalLog(msg);
            if (!occupiedFactions.includes(targetFaction)) {
              occupiedFactions.push(targetFaction);
            }
            break;
          }
        }
        if (assigned) return;
      }

      executeFallbackCrime(ns, i, currentTask, p, logger, addLocalLog);
      break;
    }

    case "COMPANY": {
      const isRushActive = currentState?.strategy === "MONEY";
      // Korrektur: Prüft jetzt die Hacking-Skill des Sleeves!
      if (!isRushActive && stats.skills.hacking >= 250) {
        const employedCorps = Object.keys(p.jobs).filter((job) =>
          MEGACORPS.includes(job as CompanyName),
        ) as CompanyName[];

        if (employedCorps.length > 0) {
          const targetCorp = employedCorps[i % employedCorps.length];
          const currentCompanyRep = ns.singularity.getCompanyRep(targetCorp);
          const requiredRep = targetCorp === "Fulcrum Technologies" ? 400_000 : 200_000;

          if (currentCompanyRep < requiredRep) {
            const targetStatThreshold = 300;
            const targetCity = p.money >= 200_000 ? "Volhaven" : "Sector-12";
            const bestUniversity =
              targetCity === "Volhaven" ? "ZB Institute of Technology" : "Rothman University";

            // Reiselogik
            if (
              stats.skills.hacking < targetStatThreshold ||
              stats.skills.charisma < targetStatThreshold
            ) {
              if (stats.city !== targetCity) {
                if (p.money >= 200_000) {
                  if (ns.sleeve.travel(i, targetCity)) {
                    const msg = `✈️ Klon #${i} reist von ${stats.city} nach ${targetCity} für die Universität.`;
                    logger.info(msg);
                    addLocalLog(msg);
                  }
                } else {
                  const msg = `⚠️ Klon #${i}: Geldmangel ($200k benötigt) für Reise nach ${targetCity}. Weiche auf Crime aus.`;
                  logger.warn(msg);
                  addLocalLog(msg);
                }
              }
            }

            // Korrektur: Sleeve-Stats prüfen statt Player-Stats
            if (stats.skills.hacking < targetStatThreshold) {
              if (
                currentTask?.type === "CLASS" &&
                currentTask?.classType === "Algorithms" &&
                currentTask?.location === bestUniversity
              ) {
                return;
              }
              ns.sleeve.setToUniversityCourse(i, bestUniversity, "Algorithms");
              const msg = `🎓 Klon #${i} lernt Algorithms an der ${bestUniversity}.`;
              logger.info(msg);
              addLocalLog(msg);
              return;
            } else if (stats.skills.charisma < targetStatThreshold) {
              if (
                currentTask?.type === "CLASS" &&
                currentTask?.classType === "Leadership" &&
                currentTask?.location === bestUniversity
              ) {
                return;
              }
              ns.sleeve.setToUniversityCourse(i, bestUniversity, "Leadership");
              const msg = `🎓 Klon #${i} lernt Leadership an der ${bestUniversity}.`;
              logger.info(msg);
              addLocalLog(msg);
              return;
            } else {
              if (currentTask?.type === "COMPANY" && currentTask?.companyName === targetCorp) {
                return;
              }
              if (ns.sleeve.setToCompanyWork(i, targetCorp)) {
                const msg = `🏢 Klon #${i} farmt jetzt Ruf bei ${targetCorp}.`;
                logger.info(msg);
                addLocalLog(msg);
                return;
              }
            }
          }
        }
      }

      executeFallbackCrime(ns, i, currentTask, p, logger, addLocalLog);
      break;
    }

    case "CRIME":
    default:
      executeFallbackCrime(ns, i, currentTask, p, logger, addLocalLog);
      break;
  }
}

/**
 * Automatisches Kaufen aller bezahlbaren Sleeve-Augmentations pro Tick.
 */
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

    // Günstigste zuerst
    purchasableAugs.sort((a, b) => a.cost - b.cost);

    for (const aug of purchasableAugs) {
      if (p.money > aug.cost * BUDGET_MULTIPLIER) {
        if (ns.sleeve.purchaseSleeveAug(i, aug.name)) {
          const msg = `🛒 Klon #${i}: Augment erworben -> ${aug.name}`;
          logger.success(msg);
          addLocalLog(msg);
        }
      } else {
        break; // Sobald eines zu teuer ist, abbrechen
      }
    }
  } catch {
    /* Safe ignore if API missing */
  }
}

/**
 * Standard-Kriminalitäts-Fallback-Logik.
 */
function executeFallbackCrime(
  ns: NS,
  i: number,
  currentTask: SleeveTask | null,
  p: Player,
  logger: Logger,
  addLocalLog: (msg: string) => void,
): void {
  // Wenn Gang-Gründung Ziel ist (-54k Karma), dauerhaft Homicide nutzen:
  const targetCrime = ns.heart.break() > -54000 ? "Homicide" : "Mug";

  if (currentTask?.type === "CRIME" && currentTask?.crimeType === targetCrime) {
    return;
  }

  ns.sleeve.setToCommitCrime(i, targetCrime);
  const msg = `🔫 Klon #${i} wechselt auf Kriminalität: ${targetCrime}`;
  logger.warn(msg);
  addLocalLog(msg);
}