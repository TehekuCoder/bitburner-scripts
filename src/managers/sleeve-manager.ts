// managers/sleeve-manager.ts
import { NS, FactionName, Player, FactionWorkType, UniversityClassType } from "@ns";
import { printSleeveDashboard } from "ui/sleeve-ui.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { loadSleeveState, patchSleeveState } from "/lib/state.js";
import {
  SleeveOptions,
  SleeveMode,
  SleeveGangUnlockStatus,
} from "/lib/types/sleeves.js";
import { SleeveTaskAssignment, getSleeveStatuses, setSleeveTask } from "/lib/utils/sleeve-utils";

type ExtendedGangStatus = SleeveGangUnlockStatus & { gangFaction?: string };

/**
 * Prüft den Fortschritt bezüglich des Gang-Unlocks und ermittelt ggf. die Gang-Fraktion.
 */
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

/**
 * Filtert Fraktionen, bei denen der Spieler Mitglied ist und noch Reputation benötigt.
 * Schließt die eigene Gang-Fraktion aus.
 */
function getFactionsNeedingRep(
  ns: NS,
  playerFactions: string[],
  ownedAugs: string[],
  gangFaction?: string
): FactionName[] {
  const validFactions = playerFactions.filter((f) => f !== gangFaction);

  if (!ns.singularity) return validFactions as FactionName[];

  const result: FactionName[] = [];
  for (const faction of validFactions) {
    const augs = ns.singularity.getAugmentationsFromFaction(faction as FactionName);
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

/**
 * Ermittelt die beste Aufgabe für einen Sleeve und vermeidet Doppelbelegungen von Fraktionen.
 */
function resolveSleeveAssignment(
  sleeveId: number,
  sleeveShock: number,
  sleeveSync: number,
  options: SleeveOptions,
  gangStatus: ExtendedGangStatus,
  factionsNeedingRep: FactionName[],
  assignedFactions: Set<string>
): SleeveTaskAssignment {
  // 1. Shock Recovery (Höchste Prio)
  if (sleeveShock > 0) {
    return { mode: "RECOVERY" };
  }

  // 2. Synchronisation (Zweite Prio)
  if (sleeveSync < 100) {
    return { mode: "SYNCHRO" };
  }

  // Noch verbleibende, nicht belegte Fraktionen für diesen Durchlauf
  const availableFactions = factionsNeedingRep.filter((f) => !assignedFactions.has(f));

  // 3. Manueller Global-Mode Override
  if (
    options.globalMode &&
    options.globalMode !== "RECOVERY" &&
    options.globalMode !== "SYNCHRO"
  ) {
    switch (options.globalMode) {
      case "CRIME":
        return { mode: "CRIME", target: "Homicide" };
      case "FACTION": {
        let fac = (options.targetFaction as FactionName) || availableFactions[0];

        if (gangStatus.gangFaction && fac === gangStatus.gangFaction) {
          fac = availableFactions.find((f) => f !== gangStatus.gangFaction) as FactionName;
        }

        if (fac && !assignedFactions.has(fac)) {
          return { mode: "FACTION", target: fac, subType: "field" };
        }
        break; // Falls belegt oder ungültig, weiter zu dynamischer Verteilung / Fallback
      }
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

  // 4. Karma-Grind für Gang-Unlock (-54.000 Karma)
  if (gangStatus.shouldGrindKarma) {
    return { mode: "CRIME", target: "Homicide" };
  }

  // 5. Faction Reputation Farmen (Nur freie Fraktionen vergeben)
  if (availableFactions.length > 0) {
    const targetFaction = availableFactions[0];
    return {
      mode: "FACTION",
      target: targetFaction,
      subType: "field" as FactionWorkType,
    };
  }

  // 6. Fallback: Homicide für Geld & Stats
  return { mode: "CRIME", target: "Homicide" };
}

/**
 * Steuert alle verlinkten Sleeves schrittweise an.
 */
function manageAllSleeves(
  ns: NS,
  player: Player,
  options: SleeveOptions,
  ownedAugs: string[],
  factionsNeedingRep: FactionName[],
  logger: Logger,
  addLocalLog: (msg: string) => void
): string {
  const statuses = getSleeveStatuses(ns);
  const tasksSummary: string[] = [];
  const gangStatus = checkSleeveGangStatus(ns);

  // Verfolgt Fraktionen, die in diesem Tick bereits von einem Sleeve belegt wurden
  const assignedFactions = new Set<string>();

  for (const sleeve of statuses) {
    const assignment = resolveSleeveAssignment(
      sleeve.id,
      sleeve.shock,
      sleeve.sync,
      options,
      gangStatus,
      factionsNeedingRep,
      assignedFactions
    );

    if (assignment.mode === "FACTION" && assignment.target) {
      assignedFactions.add(assignment.target);
    }

    const success = setSleeveTask(ns, sleeve.id, assignment);

    if (success) {
      tasksSummary.push(`S${sleeve.id}:${assignment.mode}`);
    } else {
      // Fallback falls Zuweisung fehlschlägt
      setSleeveTask(ns, sleeve.id, { mode: "CRIME", target: "Homicide" });
      tasksSummary.push(`S${sleeve.id}:CRIME(FB)`);
    }
  }

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
    };

    let ownedAugs: string[] = [];
    if (ns.singularity !== undefined) {
      ownedAugs = ns.singularity.getOwnedAugmentations(true);
    }

    if (
      lastFactionScan === 0 ||
      Date.now() - lastFactionScan > SCAN_INTERVAL
    ) {
      factionsNeedingRep = getFactionsNeedingRep(
        ns,
        p.factions,
        ownedAugs,
        unlockStatus.gangFaction
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
      addLocalLog
    );

    if (currentProgress && currentProgress !== lastStateProgress) {
      patchSleeveState(ns, { sleeveProgress: currentProgress });
      lastStateProgress = currentProgress;
    }

    printSleeveDashboard(ns, numSleeves, localLogBuffer);

    await ns.sleep(2000);
  }
}