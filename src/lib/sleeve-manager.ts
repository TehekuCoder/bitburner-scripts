import { NS, FactionName, FactionWorkType, CompanyName, GymType } from "@ns";
import { Logger } from "../core/logger.js";

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

export const COMBAT_KEYS = ["strength", "defense", "dexterity", "agility"] as const;
export const GYM_STAT_MAP: Record<string, GymType> = {
  strength: "str" as GymType,
  defense: "def" as GymType,
  dexterity: "dex" as GymType,
  agility: "agi" as GymType,
};

/**
 * Ermittelt, bei welchen Fraktionen noch Ruf für fehlende Augmentations benötigt wird.
 */
export function getFactionsNeedingRep(ns: NS, playerFactions: string[], ownedAugs: string[]): FactionName[] {
  const factionsNeedingRep: FactionName[] = [];
  for (const faction of playerFactions) {
    let maxRepNeeded = 0;
    try {
      // 🟢 Fix Line 33: Expliziter Cast auf FactionName
      const factionAugs = ns.singularity.getAugmentationsFromFaction(faction as FactionName); 
      for (const aug of factionAugs) {
        if (aug !== "NeuroFlux Governor" && !ownedAugs.includes(aug)) {
          const req = ns.singularity.getAugmentationRepReq(aug);
          if (req > maxRepNeeded) maxRepNeeded = req;
        }
      }
    } catch {
      continue;
    }

    // 🟢 Fix Line 44: Expliziter Cast auf FactionName
    const currentRep = ns.singularity.getFactionRep(faction as FactionName); 
    if (currentRep < maxRepNeeded) {
      factionsNeedingRep.push(faction as FactionName);
    }
  }
  return factionsNeedingRep;
}
/**
 * Kern-Entscheidungs-Engine für alle Sleeves.
 */
export function manageAllSleeves(
  ns: NS,
  p: any,
  currentState: any,
  ownedAugs: string[],
  factionsNeedingRep: FactionName[],
  logger: Logger,
  addLocalLog: (msg: string) => void
): void {
  const numSleeves = ns.sleeve.getNumSleeves();
  const BUDGET_MULTIPLIER = 10;

  // 1. PRE-SCAN: Welche Fraktionen sind bereits durch andere Sleeves besetzt?
  const occupiedFactions: FactionName[] = [];
  for (let i = 0; i < numSleeves; i++) {
    const task = ns.sleeve.getTask(i);
    const stats = ns.sleeve.getSleeve(i);
    if (stats.shock === 0 && stats.sync === 100 && task?.type === "FACTION") {
      const fName = task.factionName as FactionName;
      if (factionsNeedingRep.includes(fName) && !occupiedFactions.includes(fName)) {
        occupiedFactions.push(fName);
      }
    }
  }

  // 2. Individuelle Sleeve-Zuweisung
  for (let i = 0; i < numSleeves; i++) {
    const stats = ns.sleeve.getSleeve(i);
    const currentTask = ns.sleeve.getTask(i);

    // --- PHASE 1: SCHOCK-ABBAU ---
    if (stats.shock > 0) {
      if (currentTask?.type !== "RECOVERY") {
        ns.sleeve.setToShockRecovery(i);
        const msg = `💔 Klon #${i} geht in die Schock-Therapie.`;
        logger.info(msg);
        addLocalLog(msg);
      }
      continue;
    }

    // --- PHASE 2: SYNCHRONISATION ---
    if (stats.sync < 100) {
      if (currentTask?.type !== "SYNCHRO") {
        ns.sleeve.setToSynchronize(i);
        const msg = `⚡ Klon #${i} startet Gehirn-Synchronisation.`;
        logger.info(msg);
        addLocalLog(msg);
      }
      continue;
    }

    // --- PHASE 3: AUTOMATISCHES AUGMENT-SHOPPING ---
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

    // --- PHASE 4: STRATEGISCHE ARBEITSZUTEILUNG ---
    const lowestStatName = COMBAT_KEYS.reduce((a, b) =>
      stats.skills[a] < stats.skills[b] ? a : b
    );
    const lowestSleeveCombatStat = stats.skills[lowestStatName];
    const minRequiredStat = currentState?.targetStat || 0;

    if (factionsNeedingRep.length > 0) {
      // 🛑 GLOBAL OVERRIDE: Kriminalität erzwungen
      if (currentState?.strategy === "CRIME" || currentState?.strategy === "KILLS") {
        const targetCrime = "Homicide";
        if (currentTask?.type !== "CRIME" || currentTask?.crimeType !== targetCrime) {
          ns.sleeve.setToCommitCrime(i, targetCrime);
          const msg = `🔫 Klon #${i}: Globaler Roadmap-Push aktiv -> ${targetCrime}.`;
          logger.warn(msg);
          addLocalLog(msg);
        }
        continue;
      }

      // Globaler Trainingsmodus
      if (
        currentState?.strategy === "TRAIN" &&
        minRequiredStat > 0 &&
        lowestSleeveCombatStat < minRequiredStat
      ) {
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
        continue;
      }

      // Fraktions-Zuweisung ermitteln
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
        // 🏋️ INTERN-BOOTCAMP (Vor Fraktionsarbeit)
        if (minRequiredStat > 0 && lowestSleeveCombatStat < minRequiredStat) {
          const gymName = stats.city === "Volhaven" ? "Powerhouse Gym" : "Iron Gym";
          const targetGymStat = GYM_STAT_MAP[lowestStatName];

          if (
            currentTask?.type !== "CLASS" ||
            currentTask?.classType !== targetGymStat ||
            currentTask?.location !== gymName
          ) {
            ns.sleeve.setToGymWorkout(i, gymName, targetGymStat);
            const msg = `🏋️ Klon #${i}: Live-Bootcamp für ${targetFaction} aktiv -> Trainiert ${targetGymStat} (Ziel: ${minRequiredStat}).`;
            logger.info(msg);
            addLocalLog(msg);
          }
          continue;
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
        if (assigned) continue;
      }
    }

    // 🥈 PRIO 2: Unternehmens-Dienst & Uni-Push
    const isRushActive = currentState?.strategy === "PSERV_RUSH";

    if (!isRushActive && p.skills.hacking >= 250) {
      const employedCorps = Object.keys(p.jobs).filter((job) => MEGACORPS.includes(job)) as CompanyName[];

      if (employedCorps.length > 0) {
        const targetCorp = employedCorps[i % employedCorps.length];
        const currentCompanyRep = ns.singularity.getCompanyRep(targetCorp);
        const requiredRep = targetCorp === "Fulcrum Technologies" ? 400_000 : 200_000;

        if (currentCompanyRep < requiredRep) {
          const targetStatThreshold = 300;
          const targetCity = p.money >= 200_000 ? "Volhaven" : "Sector-12";
          const bestUniversity = targetCity === "Volhaven" ? "ZB Institute of Technology" : "Rothman University";

          // ✈️ REISE-LOGIK
          if (p.skills.hacking < targetStatThreshold || p.skills.charisma < targetStatThreshold) {
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

          // A) HACKING-Defizit ausgleichen
          if (p.skills.hacking < targetStatThreshold) {
            if (
              currentTask?.type === "CLASS" &&
              currentTask?.classType === "Algorithms" &&
              currentTask?.location === bestUniversity
            ) {
              continue;
            }
            ns.sleeve.setToUniversityCourse(i, bestUniversity, "Algorithms");
            const msg = `🎓 Klon #${i} lernt Algorithms an der ${bestUniversity}.`;
            logger.info(msg);
            addLocalLog(msg);
            continue;
          }

          // B) CHARISMA-Defizit ausgleichen
          else if (p.skills.charisma < targetStatThreshold) {
            if (
              currentTask?.type === "CLASS" &&
              currentTask?.classType === "Leadership" &&
              currentTask?.location === bestUniversity
            ) {
              continue;
            }
            ns.sleeve.setToUniversityCourse(i, bestUniversity, "Leadership");
            const msg = `🎓 Klon #${i} lernt Leadership an der ${bestUniversity}.`;
            logger.info(msg);
            addLocalLog(msg);
            continue;
          }

          // C) Bereit für Firmen-Ruf
          else {
            if (currentTask?.type === "COMPANY" && currentTask?.companyName === targetCorp) {
              continue;
            }
            if (ns.sleeve.setToCompanyWork(i, targetCorp)) {
              const msg = `🏢 Klon #${i} farmt jetzt Ruf bei ${targetCorp}.`;
              logger.info(msg);
              addLocalLog(msg);
              continue;
            }
          }
        }
      }
    }

    // 🥉 PRIO 3: Fallback-Kriminalität
    const targetCrime = ns.heart.break() > -22 || p.numPeopleKilled < 30 ? "Homicide" : "Mug";

    if (currentTask?.type === "CRIME" && currentTask?.crimeType === targetCrime) {
      continue;
    }

    ns.sleeve.setToCommitCrime(i, targetCrime);
    const msg = `🔫 Klon #${i} wechselt auf Fallback-Kriminalität: ${targetCrime}`;
    logger.warn(msg);
  }
}