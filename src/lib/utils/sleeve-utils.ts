// lib/utils/sleeve-utils.ts
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

/**
 * Formatiert den aktuellen Task eines Sleeves typensicher in einen Lesbaren String.
 */
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

/**
 * Liest den vollständigen Zustand aller Sleeves aus.
 */
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

/**
 * Weist einem einzelnen Sleeve eine spezifische Aufgabe zu.
 */
export function setSleeveTask(
  ns: NS,
  sleeveId: number,
  assignment: SleeveTaskAssignment
): boolean {
  if (!ns.sleeve) return false;

  switch (assignment.mode) {
    case "RECOVERY":
      return ns.sleeve.setToShockRecovery(sleeveId);

    case "SYNCHRO":
      return ns.sleeve.setToSynchronize(sleeveId);

    case "CRIME":
      return ns.sleeve.setToCommitCrime(
        sleeveId,
        (assignment.target as CrimeType) || ("Homicide" as CrimeType)
      );

    case "COMPANY":
      if (!assignment.target) return false;
      return ns.sleeve.setToCompanyWork(sleeveId, assignment.target as CompanyName);

    case "FACTION":
      if (!assignment.target || !assignment.subType) return false;
      return (
        ns.sleeve.setToFactionWork(
          sleeveId,
          assignment.target as FactionName,
          assignment.subType as FactionWorkType
        ) ?? false
      );

    case "UNI":
      if (!assignment.target || !assignment.subType) return false;
      return ns.sleeve.setToUniversityCourse(
        sleeveId,
        assignment.target as any,
        assignment.subType as UniversityClassType
      );

    default:
      return false;
  }
}

/**
 * Ermittelt den primären Ziel-Modus basierend auf den aktuellen Thresholds.
 */
export function getRecommendedTask(ns: NS, sleeveId: number): SleeveTaskAssignment {
  const stats = ns.sleeve.getSleeve(sleeveId);

  // Shock abbauen hat höchste Priorität
  if (stats.shock > 0) {
    return { mode: "RECOVERY" };
  }

  // Synchronisation bis 100% wiederherstellen
  if (stats.sync < 100) {
    return { mode: "SYNCHRO" };
  }

  // Standard-Fallback für Karma / Money
  return { mode: "CRIME", target: "Homicide" };
}