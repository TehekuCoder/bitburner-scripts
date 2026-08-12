import {
  NS,
  FactionName,
  Player,
  FactionWorkType,
  UniversityClassType,
} from "@ns";
import { printSleeveDashboard } from "/ui/sleeve-ui.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { loadSleeveState, patchSleeveState } from "/lib/state.js";
import {
  SleeveOptions,
  SleeveMode,
  SleeveGangUnlockStatus,
} from "/lib/types/sleeves.js";
import {
  SleeveTaskAssignment,
  getSleeveStatuses,
  setSleeveTask,
} from "/lib/utils/sleeve-utils.js";

type ExtendedGangStatus = SleeveGangUnlockStatus & { gangFaction?: string };

function checkSleeveGangStatus(ns: NS): ExtendedGangStatus {
  const hasSleeves = ns.sleeve !== undefined && ns.sleeve.getNumSleeves() > 0;
  const hasGangApi = ns.gang !== undefined;
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
    hasSleeves,
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
): SleeveTaskAssignment {
  // 1️⃣ NOTFALL: Schock abbauen & Synchronisieren
  if (sleeveShock > 0) {
    return { mode: "RECOVERY" };
  }

  if (sleeveSync < 100) {
    return { mode: "SYNCHRO" };
  }

  // 2️⃣ DOMINION / XP-RUSH (Prüft Strategy, Flag UND globalMode)
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
    (f) => !assignedFactions.has(f),
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
            (f) => f !== gangStatus.gangFaction,
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
      case "COMPANY":
        return { mode: "COMPANY", target: "ECORP" };
    }
  }

  // 4️⃣ STRATEGIE-REAKTION
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

  // 6️⃣ FALLBACK: Homicide
  return { mode: "CRIME", target: "Homicide" };
}

function manageAllSleeves(
  ns: NS,
  player: Player,
  options: SleeveOptions,
  ownedAugs: string[],
  factionsNeedingRep: FactionName[],
  logger: Logger,
  addLocalLog: (msg: string) => void,
): string {
  const statuses = getSleeveStatuses(ns);
  const gangStatus = checkSleeveGangStatus(ns);

  const assignedFactions = new Set<string>();
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
    );

    if (assignment.mode === "FACTION" && assignment.target) {
      assignedFactions.add(assignment.target);
    }

    plannedAssignments.push({ sleeveId: sleeve.id, assignment });
  }

  // 2. Ausführung
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
      setSleeveTask(ns, sleeveId, { mode: "CRIME", target: "Homicide" });
      tasksSummaryMap.set(sleeveId, `S${sleeveId}:CRIME(FB)`);
    }
  }

  const tasksSummary = statuses.map(
    (s) => tasksSummaryMap.get(s.id) ?? `S${s.id}:IDLE`,
  );
  return tasksSummary.join(" | ");
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  ns.ui.openTail();
  ns.ui.setTailTitle("Zentrale Sleeve-Verwaltung");
  ns.ui.resizeTail(800, 320);

  const logger = new Logger(ns, "SLEEVE");
  logger.info("🦾 Sleeve-Subsystem aktiv. Kontrolliere Klone...");

  let factionsNeedingRep: FactionName[] = [];
  let lastFactionScan = 0;
  let lastStateProgress = "";
  let lastStatusMsg = "";
  const SCAN_INTERVAL = 30000;

  const localLogBuffer: string[] = [];
  function addLocalLog(msg: string) {
    localLogBuffer.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (localLogBuffer.length > 5) localLogBuffer.shift();
  }

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
      statusMsg = `🟢 Sleeves + Gang aktiv (${unlockStatus.gangFaction ?? "Gang"} wird ignoriert)`;
    } else if (unlockStatus.shouldGrindKarma) {
      statusMsg = `🟡 Sleeves aktiv, Gang ausstehend (Karma: ${ns.heart.break().toFixed(0)} / -54000)`;
    } else if (unlockStatus.hasGangApi) {
      statusMsg = "🟢 Sleeves + Gang-API bereit (Karma-Ziel erreicht)";
    } else {
      statusMsg = "🔵 Sleeves-only Modus (Keine Gang-API im Node)";
    }

    if (statusMsg !== lastStatusMsg) {
      logger.info(statusMsg);
      addLocalLog(statusMsg);
      lastStatusMsg = statusMsg;
    }

    const p = ns.getPlayer();

    const botState = loadSleeveState(ns);
    const options: SleeveOptions = {
      globalMode: botState?.sleeveGlobalMode as SleeveMode | undefined,
      targetFaction: botState?.targetFaction,
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
      lastFactionScan = Date.now();
    }

    const currentProgress = manageAllSleeves(
      ns,
      p,
      options,
      ownedAugs,
      factionsNeedingRep,
      logger,
      addLocalLog,
    );

    if (currentProgress && currentProgress !== lastStateProgress) {
      patchSleeveState(ns, { sleeveProgress: currentProgress });
      lastStateProgress = currentProgress;
    }

    printSleeveDashboard(ns, numSleeves, localLogBuffer);

    await ns.sleep(2000);
  }
}