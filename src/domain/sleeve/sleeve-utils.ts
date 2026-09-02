import {
  NS,
  CrimeType,
  CompanyName,
  FactionName,
  FactionWorkType,
  UniversityClassType,
  SleeveTask,
} from "@ns";
import { SleeveMode } from "/shared/types/sleeves.js";
import { MEGACORPS } from "../../shared/constants/factions";
import { LoggerClient } from "../../infrastructure/logging/logger-client";

export interface SleeveStatus {
  id: number;
  shock: number;
  sync: number;
  city: string;
  hp: { current: number; max: number };
  stats: {
    hacking: number;
    strength: number;
    defense: number;
    dexterity: number;
    agility: number;
    charisma: number;
  };
  currentTask: string;
  isIdle: boolean;
}

export interface SleeveTaskAssignment {
  mode: SleeveMode;
  target?: string;
  subType?: string;
}

function formatSleeveTask(task: SleeveTask | null): string {
  if (!task) return "Idle";
  const t = task as any;
  const detail =
    t.actionName ??
    t.crimeType ??
    t.factionName ??
    t.companyName ??
    t.classType ??
    t.location ??
    "";

  return detail ? `${t.type}: ${detail}` : `${t.type}`;
}

export function getSleeveStatuses(ns: NS): SleeveStatus[] {
  if (!ns.sleeve) return [];

  const numSleeves = ns.sleeve.getNumSleeves();
  const statuses: SleeveStatus[] = [];

  for (let i = 0; i < numSleeves; i++) {
    const stats = ns.sleeve.getSleeve(i);
    const task = ns.sleeve.getTask(i);

    statuses.push({
      id: i,
      shock: stats.shock,
      sync: stats.sync,
      city: stats.city,
      hp: { current: stats.hp.current, max: stats.hp.max },
      stats: {
        hacking: stats.skills.hacking,
        strength: stats.skills.strength,
        defense: stats.skills.defense,
        dexterity: stats.skills.dexterity,
        agility: stats.skills.agility,
        charisma: stats.skills.charisma,
      },
      currentTask: formatSleeveTask(task),
      isIdle: !task,
    });
  }

  return statuses;
}

export function setSleeveTask(
  ns: NS,
  sleeveId: number,
  assignment: SleeveTaskAssignment,
): boolean {
  const logger = new LoggerClient(ns, "SLEEVE", `sleeve-${sleeveId}`);

  if (!ns.sleeve) {
    logger.error(
      "Sleeve API ist nicht verfügbar (Source-File 10 erforderlich).",
    );
    return false;
  }

  const currentTask = ns.sleeve.getTask(sleeveId);
  if (isSameTask(currentTask, assignment)) {
    return true;
  }

  switch (assignment.mode) {
    case "RECOVERY": {
      const success = ns.sleeve.setToShockRecovery(sleeveId);
      if (!success) {
        logger.warn(
          `Konnte Shock Recovery für Sleeve ${sleeveId} nicht aktivieren.`,
        );
      }
      return success;
    }

    case "SYNCHRO": {
      const success = ns.sleeve.setToSynchronize(sleeveId);
      if (!success) {
        logger.warn(
          `Konnte Synchronize für Sleeve ${sleeveId} nicht aktivieren.`,
        );
      }
      return success;
    }

    case "CRIME": {
      const targetCrime =
        (assignment.target as CrimeType) || ("Homicide" as CrimeType);
      const success = ns.sleeve.setToCommitCrime(sleeveId, targetCrime);
      if (!success) {
        logger.warn(
          `Konnte Verbrechen '${targetCrime}' für Sleeve ${sleeveId} nicht setzen.`,
        );
      }
      return success;
    }

    case "COMPANY": {
      if (!assignment.target) {
        logger.warn(
          `COMPANY Task fehlgeschlagen: Kein Zielunternehmen angegeben.`,
          undefined,
          {
            context: { sleeveId, mode: assignment.mode },
          },
        );
        return false;
      }

      const targetInput = assignment.target;
      const company: CompanyName =
        MEGACORPS[targetInput] ?? (targetInput as CompanyName);

      const player = ns.getPlayer();
      const isEmployed =
        player.jobs && Object.keys(player.jobs).includes(company);

      if (!isEmployed) {
        logger.warn(
          `Sleeve ${sleeveId} kann nicht für '${company}' arbeiten: Spieler ist dort nicht angestellt.`,
        );
        return false;
      }

      try {
        const success = ns.sleeve.setToCompanyWork(sleeveId, company);
        if (!success) {
          logger.warn(
            `setToCompanyWork für '${company}' gab false zurück.`,
            undefined,
            {
              context: { sleeveId, company },
            },
          );
        }
        return success;
      } catch (err) {
        logger.error(
          `Fehler bei setToCompanyWork für '${company}': ${err}`,
          undefined,
          {
            context: { sleeveId, company },
          },
        );
        return false;
      }
    }

    case "FACTION": {
      if (!assignment.target) {
        logger.warn(`FACTION Task fehlgeschlagen: Keine Fraktion angegeben.`);
        return false;
      }
      const targetFaction = assignment.target as FactionName;

      const candidates: FactionWorkType[] = [];
      if (assignment.subType) {
        candidates.push(assignment.subType as FactionWorkType);
      }
      candidates.push("hacking", "field", "security");

      const uniqueCandidates = [...new Set(candidates)];

      for (const workType of uniqueCandidates) {
        try {
          const success = ns.sleeve.setToFactionWork(
            sleeveId,
            targetFaction,
            workType,
          );
          if (success) return true;
        } catch (err) {
          logger.debug(
            `Fraktionsarbeit '${workType}' bei '${targetFaction}' nicht möglich: ${err}`,
          );
        }
      }

      logger.warn(
        `Kein passender Arbeitstyp für Fraktion '${targetFaction}' gefunden.`,
        undefined,
        {
          context: {
            sleeveId,
            targetFaction,
            triedTypes: uniqueCandidates.join(","),
          },
        },
      );
      return false;
    }

    case "UNI": {
      if (!assignment.subType) {
        logger.warn(`UNI Task fehlgeschlagen: Kein Kurs (subType) angegeben.`);
        return false;
      }

      const sleeveInfo = ns.sleeve.getSleeve(sleeveId);
      let uniName = assignment.target ?? "Rothman University";

      if (sleeveInfo.city === "Aevum") {
        uniName = "Summit University";
      } else if (sleeveInfo.city === "Volhaven") {
        uniName = "ZB Institute of Technology";
      } else if (sleeveInfo.city !== "Sector-12") {
        const traveled = ns.sleeve.travel(sleeveId, "Sector-12");
        if (!traveled) {
          logger.warn(`Sleeve ${sleeveId} konnte nicht nach Sector-12 reisen.`);
        }
        uniName = "Rothman University";
      }

      try {
        const success = ns.sleeve.setToUniversityCourse(
          sleeveId,
          uniName as any,
          assignment.subType as UniversityClassType,
        );
        if (!success) {
          logger.warn(
            `Konnte Kurs '${assignment.subType}' an '${uniName}' nicht belegen.`,
          );
        }
        return success;
      } catch (err) {
        logger.error(`Fehler bei setToUniversityCourse: ${err}`, undefined, {
          context: { sleeveId, uniName, course: assignment.subType },
        });
        return false;
      }
    }

    case "BLADEBURNER": {
      if (!ns.bladeburner || !ns.bladeburner.inBladeburner()) {
        logger.debug(
          `Sleeve ${sleeveId}: Bladeburner-Division ist noch nicht aktiv.`,
        );
        return false;
      }

      // Action-Name bestimmen (Standard: Field Analysis)
      let actionName = assignment.subType ?? "Field Analysis";
      const contractType = assignment.target;

      // 1. Incite Violence abfangen (Für Sleeves unzulässig)
      if (actionName === ("Incite Violence" as any)) {
        logger.warn(
          `Sleeve ${sleeveId}: 'Incite Violence' ist für Sleeves nicht erlaubt. Fallback auf 'Field Analysis'.`,
        );
        actionName = "Field Analysis";
      }

      // 2. "Infiltrate Synthoids" korrigieren
      if (actionName === ("Infiltrate synthoid group" as any)) {
        actionName = "Infiltrate Synthoids";
      }

      try {
        // API-Signatur: setToBladeburnerAction(sleeveNumber, actionName, contractType?)
        const success =
          actionName === "Take on contracts" && contractType
            ? ns.sleeve.setToBladeburnerAction(
                sleeveId,
                actionName,
                contractType as any,
              )
            : ns.sleeve.setToBladeburnerAction(sleeveId, actionName as any);

        if (!success) {
          logger.warn(
            `Bladeburner-Aktion '${actionName}' fehlgeschlagen.`,
            undefined,
            { context: { sleeveId, actionName, contractType } },
          );
        }
        return success;
      } catch (err) {
        logger.error(
          `Exception bei Bladeburner-Aktion '${actionName}': ${err}`,
          undefined,
          { context: { sleeveId, actionName, contractType } },
        );
        return false;
      }
    }

    default:
      logger.warn(
        `Unbekannter SleeveMode '${assignment.mode}' für Sleeve ${sleeveId}.`,
      );
      return false;
  }
}

export function getRecommendedTask(
  ns: NS,
  sleeveId: number,
): SleeveTaskAssignment {
  const stats = ns.sleeve.getSleeve(sleeveId);

  if (stats.shock > 0) {
    return { mode: "RECOVERY" };
  }

  if (stats.sync < 100) {
    return { mode: "SYNCHRO" };
  }

  return { mode: "CRIME", target: "Homicide" };
}

function isSameTask(
  current: SleeveTask | null,
  assignment: SleeveTaskAssignment,
): boolean {
  if (!current) return false;
  const t = current as any;

  switch (assignment.mode) {
    case "RECOVERY":
      return current.type === "RECOVERY";

    case "SYNCHRO":
      return current.type === "SYNCHRO";

    case "CRIME": {
      if (current.type !== "CRIME") return false;
      const currentCrime = t.crimeType ?? t.actionName;
      const targetCrime = assignment.target ?? "Homicide";
      return currentCrime === targetCrime;
    }

    case "COMPANY": {
      if (current.type !== "COMPANY") return false;
      const targetCompany = assignment.target
        ? (MEGACORPS[assignment.target] ?? assignment.target)
        : "";
      return t.companyName === targetCompany;
    }

    case "FACTION":
      return current.type === "FACTION" && t.factionName === assignment.target;

    case "UNI": {
      if (current.type !== "CLASS") return false;
      const currentClass = (t.classType ?? t.className ?? t.actionName ?? "")
        .toString()
        .toLowerCase();
      const targetClass = (assignment.subType ?? "").toString().toLowerCase();
      return currentClass === targetClass;
    }

    case "BLADEBURNER": {
      if (current.type !== "BLADEBURNER") return false;

      const currentName = t.actionName ?? t.actionType;

      // Wenn Verträge ausgeführt werden, ist assignment.target die konkrete Action (z.B. "Tracking")
      if (assignment.subType === "Take on contracts" && assignment.target) {
        return currentName === assignment.target;
      }

      const targetName = assignment.subType ?? "Field Analysis";
      return currentName === targetName;
    }

    default:
      return false;
  }
}
