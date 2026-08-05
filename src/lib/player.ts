import { NS, Player, FactionName, CompanyName, BitNodeMultipliers } from "@ns";
import { MEGACORPS, COMBAT_STATS, CITY_FACTIONS } from "./constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { AugmentTarget, TargetFactionResult } from "./types/factions.js";
import { BotState, StrategyResult } from "./types/strategy.js";

/**
 * Liefert alle gekauften, aber noch nicht installierten Augmentationen.
 */
export function getPurchasedUninstalledAugs(ns: NS): string[] {
  const allOwned = ns.singularity.getOwnedAugmentations(true);
  const installed = ns.singularity.getOwnedAugmentations(false);
  return allOwned.filter((aug) => !installed.includes(aug));
}

/**
 * Prüft, ob in diesem Run bereits Augmentationen erworben wurden.
 */
export function hasPurchasedAugsThisRun(ns: NS): boolean {
  return getPurchasedUninstalledAugs(ns).length > 0;
}

/**
 * Bewirbt sich bei allen Megacorps um Software-Positionen.
 */
export function applyToAllMegacorps(
  ns: NS,
  player: Player,
  logger: Logger,
): void {
  for (const corp of Object.values(MEGACORPS)) {
    try {
      ns.singularity.applyToCompany(corp, "Software");
    } catch {
      // Ignoriere Fehler, falls Kriterien noch nicht erfüllt sind
    }
  }
}

/**
 * Evaluiert die nächste Fraktion auf der Roadmap.
 * Akzeptiert bis zu 4 Parameter (inkl. optionalem currentCity).
 */
// lib/player.ts

export function findNextRoadmapFaction(
  ns: NS,
  augRoadmap: AugmentTarget[] = [],
  gangFaction?: string | null,
  currentCityParam?: string | null,
): TargetFactionResult | null {
  const player = ns.getPlayer();
  const playerFactions = player.factions;
  const invites = ns.singularity.checkFactionInvitations();
  const isBN2 = isGangOfferingAllAugs(ns);

  // 1. Wenn wir in BN2 sind UND bereits in einer Gang, ignorieren wir normale Fraktionen
  // UNTENSEITIG: Wenn Daedalus bereits freigeschaltet ist, nutzen wir Daedalus für NFG!
  const hasDaedalus =
    playerFactions.includes("Daedalus") || invites.includes("Daedalus");

  for (const target of augRoadmap) {
    // In BN2 springen wir direkt zu NFG über Daedalus/Gang, wenn TRP bereits vorhanden/kaufbar ist
    if (isBN2 && !hasDaedalus && target.name !== "The Red Pill") {
      // BN2-Gang erledigt normale Augs
      continue;
    }

    const validFactions = target.factions.filter((f) => {
      if (f === gangFaction && target.name === "The Red Pill" && !isBN2)
        return false;

      const isMember = playerFactions.includes(f);
      const hasInvite = invites.includes(f);
      return isMember || hasInvite;
    });

    if (validFactions.length === 0) continue;

    // Höchste Reputation wählen
    let bestFaction = validFactions[0];
    let maxRep = ns.singularity.getFactionRep(bestFaction);

    for (const f of validFactions) {
      const rep = ns.singularity.getFactionRep(f);
      if (rep > maxRep) {
        maxRep = rep;
        bestFaction = f;
      }
    }

    if (maxRep < target.repReq) {
      return {
        name: bestFaction,
        targetRep: target.repReq,
        augName: target.name,
        isNFG: target.name.includes("NeuroFlux Governor"),
      };
    }
  }

  return null;
}
/**
 * Ermittelt die globale Bot-Strategie anhand von Karma, Stats, Money & Roadmap.
 */
export function determineStrategy(
  ns: NS,
  player: Player,
  currentState: BotState | null,
  bnMults: BitNodeMultipliers,
  currentKarma: number,
  isOrchestratorRunning: boolean,
  factionTargets: Record<FactionName, number>,
  nextRoadmapFaction: TargetFactionResult | null,
  factionToWorkFor: TargetFactionResult | null,
  isReadyForFactionGrind: boolean,
): StrategyResult {
  // 1. Early-Game Hacking-Leveling via Uni
  if (player.skills.hacking < 30) {
    return { mode: "UNI", targetStat: 30 };
  }

  // 2. Fraktions-Reputation Grind (Vorrang für den Spieler!)
  if (factionToWorkFor && isReadyForFactionGrind) {
    const isMember = player.factions.includes(
      factionToWorkFor.name as FactionName,
    );
    if (isMember) {
      return {
        mode: "REP",
        targetFaction: factionToWorkFor.name as FactionName,
      };
    }
  }

  // 3. Fallback Karma-Grind durch den Spieler NUR WENN:
  // - Keine Gang existiert
  // - Karma noch nicht erreicht ist
  // - Keine Sleeves vorhanden sind (oder SF10 nicht gekauft/aktiv ist)
  const hasSleeves = ns.sleeve?.getNumSleeves() > 0;
  if (currentKarma > -54000 && !ns.gang.inGang() && !hasSleeves) {
    const minCombat = Math.min(...COMBAT_STATS.map((s) => player.skills[s]));
    if (minCombat < 30) {
      return { mode: "TRAIN", targetStat: 30 };
    }
    return { mode: "CRIME" };
  }

  // 4. Standard-Geldbeschaffung (Money Mode)
  return { mode: "MONEY" };
}
/**
 * Prüft, ob die Gang ALLE Augmentationen des Spiels anbietet.
 * In BitNode 2 ist dies der Fall (inkl. "The Red Pill").
 * Außerhalb von BN2 bietet die Gang nur ein klassespezifisches Sub-Set an.
 */
export function isGangOfferingAllAugs(ns: NS): boolean {
  try {
    // 1. Voraussetzungen prüfen
    if (!ns.gang || !ns.gang.inGang() || !ns.singularity) {
      return false;
    }

    const gangFaction = ns.gang.getGangInformation().faction;
    const gangAugs = ns.singularity.getAugmentationsFromFaction(gangFaction);

    // 2. Indikator 1: Enthält die Gang "The Red Pill"? (Exklusiv für BN2 Gangs)
    if (gangAugs.includes("The Red Pill")) {
      return true;
    }

    // 3. Indikator 2 (Fallback/Sicherheit): Bietet die Gang mehr als 40 verschiedene Augs an?
    // Normaler Gang-Shop: ~15-20 Augments | BN2 Gang-Shop: 60+ Augments
    const nonNfgCount = gangAugs.filter(
      (aug) => aug !== "NeuroFlux Governor",
    ).length;
    return nonNfgCount > 40;
  } catch {
    return false;
  }
}

/**
 * Prüft, ob die Daedalus-Kriterien bereits erfüllt sind oder kurz bevorstehen.
 */
export function isReadyForDaedalus(ns: NS, player: Player): boolean {
  const installedAugs = ns.singularity.getOwnedAugmentations(false).length;
  const hasMoney = player.money >= 100e9; // 100 Milliarden $
  const hasSkill =
    player.skills.hacking >= 2500 ||
    COMBAT_STATS.every((s) => player.skills[s] >= 1500);

  return installedAugs >= 30 && hasMoney && hasSkill;
}
