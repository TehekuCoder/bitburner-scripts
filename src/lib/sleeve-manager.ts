import { NS, FactionName, FactionWorkType, CompanyName, GymType } from "@ns";
import { Logger } from "../core/logger.js";
import { BotState } from "../core/state-manager.js";

export const MEGACORPS = [
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

export const COMBAT_KEYS = [
  "strength",
  "defense",
  "dexterity",
  "agility",
] as const;
export const GYM_STAT_MAP: Record<string, GymType> = {
  strength: "str" as GymType,
  defense: "def" as GymType,
  dexterity: "dex" as GymType,
  agility: "agi" as GymType,
};

export type SleeveMode =
  | "RECOVERY"
  | "SYNCHRO"
  | "TRAIN"
  | "FACTION"
  | "COMPANY"
  | "CRIME";

/**
 * Ermittelt, bei welchen Fraktionen noch Ruf für fehlende Augmentations benötigt wird.
 */
export function getFactionsNeedingRep(
  ns: NS,
  playerFactions: string[],
  ownedAugs: string[],
): FactionName[] {
  const factionsNeedingRep: FactionName[] = [];
  for (const faction of playerFactions) {
    let maxRepNeeded = 0;
    try {
      const factionAugs = ns.singularity.getAugmentationsFromFaction(
        faction as FactionName,
      );
      for (const aug of factionAugs) {
        if (aug !== "NeuroFlux Governor" && !ownedAugs.includes(aug)) {
          const req = ns.singularity.getAugmentationRepReq(aug);
          if (req > maxRepNeeded) maxRepNeeded = req;
        }
      }
    } catch {
      continue;
    }

    const currentRep = ns.singularity.getFactionRep(faction as FactionName);
    if (currentRep < maxRepNeeded) {
      factionsNeedingRep.push(faction as FactionName);
    }
  }
  return factionsNeedingRep;
}

/**
 * Entscheidet rein strategisch, in welchem Modus sich ein Sleeve befinden sollte.
 */
export function determineSleeveMode(
  ns: NS,
  stats: any,
  currentState: BotState | null,
  factionsNeedingRep: FactionName[],
): SleeveMode {
  // Grundbedürfnisse haben absolute Priorität
  if (stats.shock > 0) return "RECOVERY";
  if (stats.sync < 100) return "SYNCHRO";

  // 1. Priorität: Globaler Override aus dem State-Manager
  if (currentState?.sleeveGlobalMode) {
    return currentState.sleeveGlobalMode as SleeveMode;
  }

  // 2. Priorität: Roadmap-Strategien
  if (
    currentState?.strategy === "CRIME" ||
    currentState?.strategy === "KILLS"
  ) {
    return "CRIME";
  }
  if (currentState?.strategy === "TRAIN") {
    return "TRAIN";
  }

  // 3. Priorität: Fraktionsarbeit (wenn Ruf benötigt wird)
  if (factionsNeedingRep.length > 0) {
    return "FACTION";
  }

  // 4. Priorität: Firmen-Arbeit (wenn Hacking hoch genug ist)
  return "COMPANY";
}

/**
 * Kern-Entscheidungs-Engine für alle Sleeves (Orchestrator).
 */
export function manageAllSleeves(
  ns: NS,
  p: any,
  currentState: BotState | null,
  ownedAugs: string[],
  factionsNeedingRep: FactionName[],
  logger: Logger,
  addLocalLog: (msg: string) => void,
): void {
  const numSleeves = ns.sleeve.getNumSleeves();

  // Falls keine Sleeves vorhanden sind (z. B. im frühen Spiel / bestimmten BitNodes)
  if (numSleeves === 0) {
    if (currentState) currentState.sleeveProgress = "Keine";
    return;
  }

  // Variablen für die Fortschritts-Berechnung
  let totalShock = 0;
  let totalSync = 0;
  let activeWorkers = 0;

  // 1. PRE-SCAN: Welche Fraktionen sind bereits besetzt?
  const occupiedFactions: FactionName[] = [];
  for (let i = 0; i < numSleeves; i++) {
    const task = ns.sleeve.getTask(i);
    const stats = ns.sleeve.getSleeve(i);

    // Daten für Dashboard-Progress sammeln
    totalShock += stats.shock;
    totalSync += stats.sync;

    // Wenn task nicht null/undefined ist, arbeitet der Sleeve aktiv!
    if (task) {
      activeWorkers++;
    }

    if (stats.shock === 0 && stats.sync === 100 && task?.type === "FACTION") {
      const fName = task.factionName as FactionName;
      if (
        factionsNeedingRep.includes(fName) &&
        !occupiedFactions.includes(fName)
      ) {
        occupiedFactions.push(fName);
      }
    }
  }

  // --- NEU: SLEEVE PROGRESS FÜR DASHBOARD BERECHNEN ---
  if (currentState) {
    const avgShock = totalShock / numSleeves;
    const avgSync = totalSync / numSleeves;

    if (avgShock > 0) {
      // Phase 1: Schock-Therapie läuft noch
      currentState.sleeveProgress = `Shock: ${avgShock.toFixed(1)}%`;
    } else if (avgSync < 100) {
      // Phase 2: Synchronisation läuft noch
      currentState.sleeveProgress = `Sync: ${avgSync.toFixed(1)}%`;
    } else {
      // Phase 3: Volle Produktivität
      currentState.sleeveProgress = `${activeWorkers}/${numSleeves} Aktiv`;
    }
  }
  // ----------------------------------------------------

  // 2. Individuelle Zuweisung pro Klon
  for (let i = 0; i < numSleeves; i++) {
    const stats = ns.sleeve.getSleeve(i);
    const currentTask = ns.sleeve.getTask(i);

    // Automatisches Augment-Shopping vorab erledigen
    handleSleeveShopping(ns, i, p, logger, addLocalLog);

    // Modus bestimmen
    const mode = determineSleeveMode(
      ns,
      stats,
      currentState,
      factionsNeedingRep,
    );

    // Modus operativ ausführen
    manageSingleSleeve(
      ns,
      i,
      mode,
      stats,
      currentTask,
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
 * Führt die eigentliche Zuweisungs-Logik für einen einzelnen Klon aus.
 */
export function manageSingleSleeve(
  ns: NS,
  i: number,
  mode: SleeveMode,
  stats: any,
  currentTask: any,
  currentState: BotState | null,
  factionsNeedingRep: FactionName[],
  occupiedFactions: FactionName[],
  p: any,
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
      // Fraktions-Zuweisung ermitteln
      let targetFaction: FactionName | null = null;
      if (currentTask?.type === "FACTION") {
        const currentFaction = currentTask.factionName as FactionName;
        if (factionsNeedingRep.includes(currentFaction)) {
          targetFaction = currentFaction;
        }
      }

      if (!targetFaction) {
        const availableFactions = factionsNeedingRep.filter(
          (f) => !occupiedFactions.includes(f),
        );
        if (availableFactions.length > 0) {
          if (
            i === 0 &&
            currentState?.targetFaction &&
            availableFactions.includes(
              currentState.targetFaction as FactionName,
            )
          ) {
            targetFaction = currentState.targetFaction as FactionName;
          } else {
            targetFaction = availableFactions[0];
          }
        }
      }

      if (targetFaction) {
        // Live-Bootcamp-Check vor der Fraktionsarbeit
        if (minRequiredStat > 0 && lowestSleeveCombatStat < minRequiredStat) {
          const gymName =
            stats.city === "Volhaven" ? "Powerhouse Gym" : "Iron Gym";
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

        // Ab zur Fraktionsarbeit
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

      // Wenn Fraktionsarbeit fehlschlägt, ins Fallback (Crime) rutschen:
      executeFallbackCrime(ns, i, currentTask, p, logger, addLocalLog);
      break;
    }

    case "COMPANY": {
      const isRushActive = currentState?.strategy === "PSERV_RUSH";
      if (!isRushActive && p.skills.hacking >= 250) {
        const employedCorps = Object.keys(p.jobs).filter((job) =>
          MEGACORPS.includes(job),
        ) as CompanyName[];

        if (employedCorps.length > 0) {
          const targetCorp = employedCorps[i % employedCorps.length];
          const currentCompanyRep = ns.singularity.getCompanyRep(targetCorp);
          const requiredRep =
            targetCorp === "Fulcrum Technologies" ? 400_000 : 200_000;

          if (currentCompanyRep < requiredRep) {
            const targetStatThreshold = 300;
            const targetCity = p.money >= 200_000 ? "Volhaven" : "Sector-12";
            const bestUniversity =
              targetCity === "Volhaven"
                ? "ZB Institute of Technology"
                : "Rothman University";

            // Reiselogik
            if (
              p.skills.hacking < targetStatThreshold ||
              p.skills.charisma < targetStatThreshold
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

            // Hacking lernen
            if (p.skills.hacking < targetStatThreshold) {
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
            }

            // Charisma lernen
            else if (p.skills.charisma < targetStatThreshold) {
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
            }

            // Firmenarbeit ausführen
            else {
              if (
                currentTask?.type === "COMPANY" &&
                currentTask?.companyName === targetCorp
              ) {
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

      // Falls kein Megacorp-Job vorhanden oder fertig -> Fallback
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
 * Hilfsfunktion zum automatischen Kauf von Sleeve-Augmentations.
 */
function handleSleeveShopping(
  ns: NS,
  i: number,
  p: any,
  logger: Logger,
  addLocalLog: (msg: string) => void,
): void {
  const BUDGET_MULTIPLIER = 10;
  try {
    const purchasableAugs = ns.sleeve.getSleevePurchasableAugs(i);
    if (purchasableAugs.length > 0) {
      purchasableAugs.sort((a, b) => a.cost - b.cost);
      const cheapestAug = purchasableAugs[0];
      if (p.money > cheapestAug.cost * BUDGET_MULTIPLIER) {
        if (ns.sleeve.purchaseSleeveAug(i, cheapestAug.name)) {
          const msg = `🛒 Klon #${i}: Augment erworben -> ${cheapestAug.name}`;
          logger.success(msg);
          addLocalLog(msg);
        }
      }
    }
  } catch {
    /* Failsafe */
  }
}

/**
 * Standard-Kriminalitäts-Fallback-Logik.
 */
function executeFallbackCrime(
  ns: NS,
  i: number,
  currentTask: any,
  p: any,
  logger: Logger,
  addLocalLog: (msg: string) => void,
): void {
  const targetCrime =
    ns.heart.break() > -22 || p.numPeopleKilled < 30 ? "Homicide" : "Mug";

  if (currentTask?.type === "CRIME" && currentTask?.crimeType === targetCrime) {
    return;
  }

  ns.sleeve.setToCommitCrime(i, targetCrime);
  const msg = `🔫 Klon #${i} wechselt auf Kriminalität: ${targetCrime}`;
  logger.warn(msg);
  addLocalLog(msg);
}
