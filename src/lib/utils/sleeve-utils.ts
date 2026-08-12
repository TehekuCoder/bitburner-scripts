import {
  NS,
  CrimeType,
  CompanyName,
  FactionName,
  FactionWorkType,
  UniversityClassType,
  SleeveTask,
} from "@ns";
import { SleeveMode } from "/lib/types/sleeves.js";
import { MEGACORPS } from "/lib/constants.js"; // ◄ Importieren

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
  if (!ns.sleeve) return false;

  const currentTask = ns.sleeve.getTask(sleeveId);
  if (isSameTask(currentTask, assignment)) {
    return true;
  }

  switch (assignment.mode) {
    case "RECOVERY":
      return ns.sleeve.setToShockRecovery(sleeveId);

    case "SYNCHRO":
      return ns.sleeve.setToSynchronize(sleeveId);

    case "CRIME":
      return ns.sleeve.setToCommitCrime(
        sleeveId,
        (assignment.target as CrimeType) || ("Homicide" as CrimeType),
      );

    case "COMPANY": {
      if (!assignment.target) return false;

      // Firmennamen über MEGACORPS auflösen (falls Alias/Key übergeben wurde)
      const targetInput = assignment.target;
      const company: CompanyName =
        MEGACORPS[targetInput] ?? (targetInput as CompanyName);

      // 1. Prüfen, ob der Spieler bei der Firma angestellt ist (über lib/player.ts geregelt)
      const player = ns.getPlayer();
      const isEmployed =
        player.jobs && Object.keys(player.jobs).includes(company);

      if (!isEmployed) {
        return false; // Player hat hier noch keinen Job -> Fail & Fallback greift
      }

      // 2. Sleeve der Firma zuweisen
      try {
        return ns.sleeve.setToCompanyWork(sleeveId, company);
      } catch {
        return false;
      }
    }

    case "FACTION": {
      if (!assignment.target) return false;
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
        } catch {
          // Nächsten Arbeitstyp probieren
        }
      }
      return false;
    }

    case "UNI": {
      if (!assignment.subType) return false;

      const sleeveInfo = ns.sleeve.getSleeve(sleeveId);
      let uniName = assignment.target ?? "Rothman University";

      if (sleeveInfo.city === "Aevum") {
        uniName = "Summit University";
      } else if (sleeveInfo.city === "Volhaven") {
        uniName = "ZB Institute of Technology";
      } else if (sleeveInfo.city !== "Sector-12") {
        ns.sleeve.travel(sleeveId, "Sector-12");
        uniName = "Rothman University";
      }

      return ns.sleeve.setToUniversityCourse(
        sleeveId,
        uniName as any,
        assignment.subType as UniversityClassType,
      );
    }

    default:
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

    default:
      return false;
  }
}
