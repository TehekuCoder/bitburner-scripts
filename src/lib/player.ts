import { NS, Player, FactionName, CompanyName, BitNodeMultipliers } from "@ns";
import { MEGACORPS, COMBAT_STATS, CITY_FACTIONS } from "./constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { AugmentTarget, TargetFactionResult } from "./types/factions.js";
import { BotState, StrategyResult } from "./types/strategy.js";

export function getPurchasedUninstalledAugs(ns: NS): string[] {
  const allOwned = ns.singularity.getOwnedAugmentations(true);
  const installed = ns.singularity.getOwnedAugmentations(false);
  return allOwned.filter((aug) => !installed.includes(aug));
}

export function hasPurchasedAugsThisRun(ns: NS): boolean {
  return getPurchasedUninstalledAugs(ns).length > 0;
}

export function applyToAllMegacorps(
  ns: NS,
  player: Player,
  logger: Logger,
): void {
  for (const corp of Object.values(MEGACORPS)) {
    try {
      ns.singularity.applyToCompany(corp, "Software");
    } catch {}
  }
}

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

  const hasDaedalus =
    playerFactions.includes("Daedalus") || invites.includes("Daedalus");

  for (const target of augRoadmap) {
    if (isBN2 && !hasDaedalus && target.name !== "The Red Pill") {
      continue;
    }

    // Gang-Fraktion NIEMALS als Ziel für manuelles Spieler-Work wählen!
    const validFactions = target.factions.filter((f) => {
      if (f === gangFaction && !isBN2) return false;

      const isMember = playerFactions.includes(f);
      const hasInvite = invites.includes(f);
      return isMember || hasInvite;
    });

    if (validFactions.length === 0) continue;

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
  const hackExpMult = bnMults.HackExpGain ?? 1;

  // 1. Early-Game Hacking-Leveling via Uni (skaliert dynamisch mit Multiplikator)
  const targetHackLevel = hackExpMult < 0.25 ? 15 : 30;
  if (player.skills.hacking < targetHackLevel) {
    return { mode: "UNI", targetStat: targetHackLevel };
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

  // 3. Karma-Grind für Gang-Freischaltung
  const hasSleeves = ns.sleeve?.getNumSleeves() > 0;
  if (currentKarma > -54000 && !ns.gang.inGang() && !hasSleeves) {
    const minCombat = Math.min(...COMBAT_STATS.map((s) => player.skills[s]));
    if (minCombat < 30) {
      return { mode: "TRAIN", targetStat: 30 };
    }
    return { mode: "CRIME" };
  }

  // 4. Gym-Fallback, falls Hacking XP schlecht ist & Daedalus Combat-Reqs (1500 Stats) gebraucht werden
  const minCombat = Math.min(...COMBAT_STATS.map((s) => player.skills[s]));
  if (hackExpMult < 0.3 && minCombat < 1500 && isNearDaedalus(ns)) {
    return { mode: "TRAIN", targetStat: 1500 };
  }

  // 5. Standard-Geldbeschaffung (Money Mode)
  return { mode: "MONEY" };
}

function isNearDaedalus(ns: NS): boolean {
  return ns.singularity.getOwnedAugmentations(false).length >= 25;
}

export function isGangOfferingAllAugs(ns: NS): boolean {
  try {
    if (!ns.gang || !ns.gang.inGang() || !ns.singularity) return false;
    const gangFaction = ns.gang.getGangInformation().faction;
    const gangAugs = ns.singularity.getAugmentationsFromFaction(gangFaction);
    if (gangAugs.includes("The Red Pill")) return true;
    const nonNfgCount = gangAugs.filter(
      (aug) => aug !== "NeuroFlux Governor",
    ).length;
    return nonNfgCount > 40;
  } catch {
    return false;
  }
}

export function isReadyForDaedalus(ns: NS, player: Player): boolean {
  const installedAugs = ns.singularity.getOwnedAugmentations(false).length;
  const hasMoney = player.money >= 100e9;
  const hasSkill =
    player.skills.hacking >= 2500 ||
    COMBAT_STATS.every((s) => player.skills[s] >= 1500);

  return installedAugs >= 30 && hasMoney && hasSkill;
}
