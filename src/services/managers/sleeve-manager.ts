import {
  NS,
  FactionName,
  Player,
  FactionWorkType,
  UniversityClassType,
  CompanyName,
} from "@ns";
import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";
import {
  SleeveOptions,
  SleeveMode,
  SleeveGangUnlockStatus,
} from "/shared/types/sleeves.js";
import {
  SleeveTaskAssignment,
  getSleeveStatuses,
  setSleeveTask,
} from "../../domain/sleeve/sleeve-utils.js";
import { MEGACORPS } from "../../shared/constants/factions.js";
import { loadSleeveState, patchSleeveState } from "/infrastructure/state/state.js";
import { hasSleeve, hasGang } from "/lib/utils.js";

type ExtendedGangStatus = SleeveGangUnlockStatus & { gangFaction?: string };

function checkSleeveGangStatus(ns: NS): ExtendedGangStatus {
  const hasSleevesApi = hasSleeve(ns) && ns.sleeve.getNumSleeves() > 0;
  const hasGangApi = hasGang(ns);
  let inGang = false;
  let gangFaction: string | undefined = undefined;

  if (hasGangApi) {
    try {
      inGang = ns.gang.inGang();
      if (inGang) {
        gangFaction = ns.gang.getGangInformation().faction;
      }
    } catch {
      inGang = false;
    }
  }

  const karma = ns.heart.break();
  const shouldGrindKarma = !inGang && karma > -54000;

  return {
    hasSleeves: hasSleevesApi,
    hasGangApi,
    inGang,
    gangFaction,
    shouldGrindKarma,
  };
}

function getFactionsNeedingRep(
  ns: NS,
  playerFactions: string[],
  ownedAugs: string[],
  gangFaction?: string,
): FactionName[] {
  const validFactions = playerFactions.filter((f) => f !== gangFaction);

  if (!ns.singularity) return validFactions as FactionName[];

  const result: FactionName[] = [];
  for (const faction of validFactions) {
    const augs = ns.singularity.getAugmentationsFromFaction(
      faction as FactionName,
    );
    const unowned = augs.filter((aug) => !ownedAugs.includes(aug));

    if (unowned.length === 0) continue;

    const currentRep = ns.singularity.getFactionRep(faction as FactionName);
    let maxRepNeeded = 0;

    for (const aug of unowned) {
      const reqRep = ns.singularity.getAugmentationRepReq(aug);
      if (reqRep > maxRepNeeded) maxRepNeeded = reqRep;
    }

    if (currentRep < maxRepNeeded) {
      result.push(faction as FactionName);
    }
  }

  return result;
}

function resolveSleeveAssignment(
  sleeveId: number,
  sleeveShock: number,
  sleeveSync: number,
  options: SleeveOptions,
  gangStatus: ExtendedGangStatus,
  factionsNeedingRep: FactionName[],
  assignedFactions: Set<string>,
  companiesNeedingRep: CompanyName[], 
  assignedCompanies: Set<string>       
): SleeveTaskAssignment {
  // 1️⃣ NOTFALL: Schock abbauen & Synchronisieren
  if (sleeveShock > 0) return { mode: "RECOVERY" };
  if (sleeveSync < 100) return { mode: "SYNCHRO" };

  // 2️⃣ DOMINION / XP-RUSH
  const isDominion =
    options.strategy === "DOMINION" ||
    options.isDominionActive === true ||
    options.globalMode === "DOMINION";

  if (isDominion) {
    return {
      mode: "UNI",
      target: "Rothman University",
      subType: "Algorithms" as UniversityClassType,
    };
  }

  const availableFactions = factionsNeedingRep.filter(
    (f) => !assignedFactions.has(f)
  );

  const availableCompanies = companiesNeedingRep.filter(
    (c) => !assignedCompanies.has(c)
  );

  // 3️⃣ EXPLIZITER OVERRIDE (sleeveGlobalMode)
  if (
    options.globalMode &&
    options.globalMode !== "RECOVERY" &&
    options.globalMode !== "SYNCHRO"
  ) {
    switch (options.globalMode) {
      case "CRIME":
        return { mode: "CRIME", target: "Homicide" };
      case "FACTION": {
        let fac =
          (options.targetFaction as FactionName) || availableFactions[0];

        if (gangStatus.gangFaction && fac === gangStatus.gangFaction) {
          fac = availableFactions.find(
            (f) => f !== gangStatus.gangFaction
          ) as FactionName;
        }

        if (fac && !assignedFactions.has(fac)) {
          return { mode: "FACTION", target: fac, subType: "hacking" };
        }
        break;
      }
      case "DOMINION":
      case "UNI":
        return {
          mode: "UNI",
          target: "Rothman University",
          subType: "Algorithms" as UniversityClassType,
        };
      case "COMPANY": {
        const primaryTarget = options.targetCompany
          ? (MEGACORPS[options.targetCompany] ?? (options.targetCompany as CompanyName))
          : undefined;

        if (primaryTarget && !assignedCompanies.has(primaryTarget)) {
          return { mode: "COMPANY", target: primaryTarget };
        }
        if (availableCompanies.length > 0) {
          return { mode: "COMPANY", target: availableCompanies[0] };
        }
        break;
      }
    }
  }

  // 4️⃣ STRATEGIE-REAKTION: COMPANY
  if (options.strategy === "COMPANY") {
    // 1. Primäres Roadmap-Ziel zuweisen (falls noch frei & benötigt)
    const primaryTarget = options.targetCompany
      ? (MEGACORPS[options.targetCompany] ?? (options.targetCompany as CompanyName))
      : undefined;

    if (
      primaryTarget &&
      !assignedCompanies.has(primaryTarget) &&
      companiesNeedingRep.includes(primaryTarget)
    ) {
      return { mode: "COMPANY", target: primaryTarget };
    }

    // 2. Andere Sleeves auf verbleibende Megacorps verteilen
    if (availableCompanies.length > 0) {
      return { mode: "COMPANY", target: availableCompanies[0] };
    }

    // 3. Fallback: Fraktions-Reputation farmen
    if (availableFactions.length > 0) {
      return {
        mode: "FACTION",
        target: availableFactions[0],
        subType: "hacking" as FactionWorkType,
      };
    }
  }

  if (options.strategy === "UNI") {
    return {
      mode: "UNI",
      target: "Rothman University",
      subType: "Algorithms" as UniversityClassType,
    };
  }

  if (options.strategy === "KARMA" || gangStatus.shouldGrindKarma) {
    return { mode: "CRIME", target: "Homicide" };
  }

  // 5️⃣ STANDARD: Fraktions-Reputation farmen
  if (availableFactions.length > 0) {
    const targetFaction = availableFactions[0];
    return {
      mode: "FACTION",
      target: targetFaction,
      subType: "hacking" as FactionWorkType,
    };
  }

  // 6️⃣ FALLBACK: Andere Firmen abklappern oder Crime
  if (availableCompanies.length > 0) {
    return { mode: "COMPANY", target: availableCompanies[0] };
  }

  return { mode: "CRIME", target: "Homicide" };
}

function manageAllSleeves(
  ns: NS,
  player: Player,
  options: SleeveOptions,
  ownedAugs: string[],
  factionsNeedingRep: FactionName[],
  companiesNeedingRep: CompanyName[],
  logger: Logger,
): string {
  const statuses = getSleeveStatuses(ns);
  const gangStatus = checkSleeveGangStatus(ns);

  const assignedFactions = new Set<string>();
  const assignedCompanies = new Set<string>();
  const plannedAssignments: {
    sleeveId: number;
    assignment: SleeveTaskAssignment;
  }[] = [];

  const isDominion =
    options.strategy === "DOMINION" ||
    options.isDominionActive === true ||
    options.globalMode === "DOMINION";

  // 1a. Bestehende valide Fraktions-Tasks beibehalten (wird im Dominion-Modus übersprungen)
  for (const sleeve of statuses) {
    const needsRecoveryOrSync = sleeve.shock > 0 || sleeve.sync < 100;

    if (
      !needsRecoveryOrSync &&
      !options.globalMode &&
      !gangStatus.shouldGrindKarma &&
      !isDominion
    ) {
      const rawTask = ns.sleeve.getTask(sleeve.id) as any;
      if (rawTask && rawTask.type === "FACTION" && rawTask.factionName) {
        const fac = rawTask.factionName as FactionName;
        if (
          factionsNeedingRep.includes(fac) &&
          fac !== gangStatus.gangFaction &&
          !assignedFactions.has(fac)
        ) {
          assignedFactions.add(fac);
          const workType = (rawTask.factionWorkType ??
            rawTask.workType ??
            "hacking") as FactionWorkType;
          plannedAssignments.push({
            sleeveId: sleeve.id,
            assignment: {
              mode: "FACTION",
              target: fac,
              subType: workType,
            },
          });
        }
      }
    }
  }

  // 1b. Restliche Sleeves versorgen
  for (const sleeve of statuses) {
    if (plannedAssignments.some((p) => p.sleeveId === sleeve.id)) continue;

    const assignment = resolveSleeveAssignment(
      sleeve.id,
      sleeve.shock,
      sleeve.sync,
      options,
      gangStatus,
      factionsNeedingRep,
      assignedFactions,
      companiesNeedingRep,
      assignedCompanies,
    );

    if (assignment.mode === "FACTION" && assignment.target) {
      assignedFactions.add(assignment.target);
    }
    if (assignment.mode === "COMPANY" && assignment.target) {
      assignedCompanies.add(assignment.target);
    }

    plannedAssignments.push({ sleeveId: sleeve.id, assignment });
  }

  // 2. Ausführung mit intelligentem Fallback
  const nonFactionTasks = plannedAssignments.filter(
    (p) => p.assignment.mode !== "FACTION",
  );
  const factionTasks = plannedAssignments.filter(
    (p) => p.assignment.mode === "FACTION",
  );

  const tasksSummaryMap = new Map<number, string>();

  for (const { sleeveId, assignment } of [
    ...nonFactionTasks,
    ...factionTasks,
  ]) {
    const success = setSleeveTask(ns, sleeveId, assignment);

    if (success) {
      tasksSummaryMap.set(sleeveId, `S${sleeveId}:${assignment.mode}`);
    } else {
      if (assignment.mode === "COMPANY") {
        const uniSuccess = setSleeveTask(ns, sleeveId, {
          mode: "UNI",
          target: "Rothman University",
          subType: "Algorithms" as UniversityClassType,
        });
        if (uniSuccess) {
          tasksSummaryMap.set(sleeveId, `S${sleeveId}:UNI(NO_JOB)`);
          logger.warn(
            `Sleeve #${sleeveId}: Noch keinen Job bei ${assignment.target}. Sende zur Uni.`,
          );
          continue;
        }
      }

      setSleeveTask(ns, sleeveId, { mode: "CRIME", target: "Homicide" });
      tasksSummaryMap.set(sleeveId, `S${sleeveId}:CRIME(FB)`);
      logger.warn(
        `Sleeve #${sleeveId}: Aufgabe ${assignment.mode} fehlgeschlagen. Fallback auf Homicide.`,
      );
    }
  }

  const tasksSummary = statuses.map(
    (s) => tasksSummaryMap.get(s.id) ?? `S${s.id}:IDLE`,
  );
  return tasksSummary.join(" | ");
}

function getCompaniesNeedingRep(
  ns: NS,
  player: Player,
  ownedAugs: string[],
): CompanyName[] {
  const result: CompanyName[] = [];
  const playerJobs = Object.keys(player.jobs || {});

  for (const [_, companyName] of Object.entries(MEGACORPS)) {
    const company = companyName as CompanyName;

    // 1. Ist der Spieler überhaupt bei der Firma angestellt? (Pflicht für Sleeves)
    if (!playerJobs.includes(company)) continue;

    // 2. Hat der Spieler die Fraktion schon beigetreten & alle Augs gekauft?
    const factionName =
      company === "Fulcrum Technologies"
        ? ("Fulcrum Secret Technologies" as FactionName)
        : (company as unknown as FactionName);

    if (player.factions.includes(factionName)) {
      if (ns.singularity) {
        const augs = ns.singularity.getAugmentationsFromFaction(factionName);
        const unowned = augs.filter((aug) => !ownedAugs.includes(aug));
        if (unowned.length === 0) continue; // Fraktion erledigt
      }
    }

    // 3. Prüfen, ob der Firmen-Ruf schon das Limit erreicht hat (200k / 250k)
    const currentRep = ns.singularity
      ? ns.singularity.getCompanyRep(company)
      : 0;
    const reqRep = company === "Fulcrum Technologies" ? 250000 : 200000;

    if (currentRep < reqRep) {
      result.push(company);
    }
  }

  return result;
}


export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const logger = new Logger(ns, "SLEEVE");
  logger.info("🦾 Sleeve-Subsystem gestartet.");

  let factionsNeedingRep: FactionName[] = [];
  let companiesNeedingRep: CompanyName[] = [];
  let lastFactionScan = 0;
  let lastStateProgress = "";
  let lastStatusMsg = "";
  const SCAN_INTERVAL = 30000;

  while (true) {
    if (ns.sleeve === undefined) {
      logger.error("🛑 Keine Sleeve-API (SF10) in diesem Node verfügbar.");
      return;
    }

    const numSleeves = ns.sleeve.getNumSleeves();
    if (numSleeves === 0) {
      logger.warn("⚠️ Keine Sleeves im Besitz.");
      await ns.sleep(10000);
      continue;
    }

    const unlockStatus = checkSleeveGangStatus(ns);
    let statusMsg = "";
    if (unlockStatus.inGang) {
      statusMsg = `Sleeves + Gang aktiv (${unlockStatus.gangFaction ?? "Gang"} wird ignoriert)`;
    } else if (unlockStatus.shouldGrindKarma) {
      statusMsg = `Sleeves aktiv, Gang ausstehend (Karma: ${ns.heart.break().toFixed(0)} / -54000)`;
    } else if (unlockStatus.hasGangApi) {
      statusMsg = "Sleeves + Gang-API bereit (Karma-Ziel erreicht)";
    } else {
      statusMsg = "Sleeves-only Modus (Keine Gang-API im Node)";
    }

    if (statusMsg !== lastStatusMsg) {
      logger.info(statusMsg);
      lastStatusMsg = statusMsg;
    }

    const p = ns.getPlayer();

    const botState = loadSleeveState(ns);
    const options: SleeveOptions = {
      globalMode: botState?.sleeveGlobalMode as SleeveMode | undefined,
      targetFaction: botState?.targetFaction,
      targetCompany: botState?.targetCompany,
      targetStat: botState?.targetStat,
      strategy: botState?.strategy,
      autoBuyAugs: botState?.autoBuyAugs,
      isDominionActive: botState?.isDominionActive,
    };

    let ownedAugs: string[] = [];
    if (ns.singularity !== undefined) {
      ownedAugs = ns.singularity.getOwnedAugmentations(true);
    }

    if (lastFactionScan === 0 || Date.now() - lastFactionScan > SCAN_INTERVAL) {
      factionsNeedingRep = getFactionsNeedingRep(
        ns,
        p.factions,
        ownedAugs,
        unlockStatus.gangFaction,
      );
      companiesNeedingRep = getCompaniesNeedingRep(ns, p, ownedAugs);
      lastFactionScan = Date.now();
    }

    const currentProgress = manageAllSleeves(
      ns,
      p,
      options,
      ownedAugs,
      factionsNeedingRep,
      companiesNeedingRep,
      logger,
    );

    if (currentProgress && currentProgress !== lastStateProgress) {
      patchSleeveState(ns, { sleeveProgress: currentProgress });
      logger.debug(`Fortschritt aktualisiert: ${currentProgress}`);
      lastStateProgress = currentProgress;
    }

    await ns.sleep(2000);
  }
}

