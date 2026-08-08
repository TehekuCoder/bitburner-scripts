import { NS, Player, FactionName, CompanyName, BitNodeMultipliers } from "@ns";
import { MEGACORPS, COMBAT_STATS, CITY_FACTIONS } from "./constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { AugmentTarget, TargetFactionResult } from "./types/factions.js";
import { BotState, StrategyResult } from "./types/strategy.js";

const EARLY_FACTIONS: FactionName[] = ["CyberSec", "Tian Di Hui", "Netburners"];

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
  logger?: Logger,
): void {
  let appliedCount = 0;
  for (const corp of Object.values(MEGACORPS)) {
    try {
      if (ns.singularity.applyToCompany(corp, "Software")) {
        appliedCount++;
      }
    } catch {}
  }
  if (appliedCount > 0 && logger) {
    logger.info(`🏢 Bei ${appliedCount} Megacorps erfolgreich beworben.`);
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

  // 🎯 DAEDALUS PRIORITÄT: Sobald freigeschaltet oder eingeladen, direkt priorisieren
  const hasDaedalus =
    playerFactions.includes("Daedalus") || invites.includes("Daedalus");
  if (hasDaedalus) {
    const daedalusTarget = augRoadmap.find(
      (t) => t.factions.includes("Daedalus") || t.name === "The Red Pill",
    );
    const targetRep = daedalusTarget ? daedalusTarget.repReq : 2_500_000;
    const currentRep = ns.singularity.getFactionRep("Daedalus");

    if (currentRep < targetRep) {
      return {
        name: "Daedalus",
        targetRep: targetRep,
        augName: daedalusTarget?.name ?? "The Red Pill",
        isNFG: false,
      };
    }
  }

  // 💡 Gang-Augmentations ermitteln
  let gangAugs: string[] = [];
  if (gangFaction && ns.gang?.inGang()) {
    try {
      gangAugs = ns.singularity.getAugmentationsFromFaction(
        gangFaction as FactionName,
      );
    } catch {}
  }

  for (const target of augRoadmap) {
    if (isBN2 && !hasDaedalus && target.name !== "The Red Pill") {
      continue;
    }

    // 💡 STRATEGIE-REGEL: Bietet die Gang dieses Augment an, überspringen wir das manuelle
    // Grind-Ziel für den Spieler VOLLSTÄNDIG (die Gang kauft/farmt es automatisch).
    if (gangFaction && gangAugs.includes(target.name)) {
      continue;
    }

    // Filtere Gang-Fraktion für manuelles Spieler-Work aus
    const validFactions = target.factions.filter((f) => {
      if (f === gangFaction && !isBN2) return false;
      return playerFactions.includes(f) || invites.includes(f);
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
  logger?: Logger, // 👈 Optionaler Logger für volle Transparenz
): StrategyResult {
  const hackExpMult = bnMults.HackExpGain ?? 1;
  const hasGang = currentState?.hasGang || ns.gang?.inGang();

  // 1. Basic Hacking Leveling
  const targetHackLevel = hackExpMult < 0.25 ? 15 : 30;
  if (player.skills.hacking < targetHackLevel) {
    logger?.debug(`[Strategie] Hacking < ${targetHackLevel} ➔ UNI`);
    return { mode: "UNI", targetStat: targetHackLevel };
  }

  // 🎯 DAEDALUS SOFORT-REP
  if (player.factions.includes("Daedalus")) {
    const daedalusTargetRep = factionTargets["Daedalus"] ?? 2_500_000;
    const currentRep = ns.singularity.getFactionRep("Daedalus");

    if (currentRep < daedalusTargetRep) {
      logger?.debug(
        `[Strategie] Daedalus Priorität active (${Math.round(currentRep)}/${daedalusTargetRep} Rep) ➔ REP`,
      );
      return { mode: "REP", targetFaction: "Daedalus" as FactionName };
    }
  }

  // 2. PHASE 1: Early-Game Fraktionen
  if (
    factionToWorkFor &&
    EARLY_FACTIONS.includes(factionToWorkFor.name as FactionName) &&
    isReadyForFactionGrind
  ) {
    if (player.factions.includes(factionToWorkFor.name as FactionName)) {
      logger?.debug(
        `[Strategie] Early-Game Faction: ${factionToWorkFor.name} ➔ REP`,
      );
      return {
        mode: "REP",
        targetFaction: factionToWorkFor.name as FactionName,
      };
    }
  }

  // 3. PHASE 2: Karma-Grind für Gang
  const hasSleeves = ns.sleeve?.getNumSleeves() > 0;
  if (!hasGang && currentKarma > -54000 && !hasSleeves) {
    const minCombat = Math.min(...COMBAT_STATS.map((s) => player.skills[s]));
    if (minCombat < 30) {
      logger?.debug(
        `[Strategie] Combat zu niedrig für Karma-Grind (${minCombat}/30) ➔ TRAIN`,
      );
      return { mode: "TRAIN", targetStat: 30 };
    }
    logger?.debug(
      `[Strategie] Farmen für Gang-Freischaltung (Karma: ${Math.round(currentKarma)}) ➔ CRIME`,
    );
    return { mode: "CRIME" };
  }

  // 4. PHASE 3: Exklusive Fraktions-Augments
  if (factionToWorkFor && isReadyForFactionGrind) {
    if (player.factions.includes(factionToWorkFor.name as FactionName)) {
      logger?.debug(
        `[Strategie] Ziel-Fraktion: ${factionToWorkFor.name} (${factionToWorkFor.augName}) ➔ REP`,
      );
      return {
        mode: "REP",
        targetFaction: factionToWorkFor.name as FactionName,
      };
    }
  }

  // 5. PHASE 4: Daedalus Freischaltung & Stat-Evaluation
  const installedAugs = ns.singularity.getOwnedAugmentations(false).length;
  if (installedAugs >= 25 || player.factions.includes("Daedalus")) {
    const minCombat = Math.min(...COMBAT_STATS.map((s) => player.skills[s]));
    const hasCombatReq = minCombat >= 1500;
    const hasHackReq = player.skills.hacking >= 2500;

    if (!hasCombatReq && !hasHackReq) {
      const isCombatFaster =
        hackExpMult < 0.3 || (minCombat >= 800 && player.skills.hacking < 1800);
      const targetMode = isCombatFaster ? "TRAIN" : "UNI";
      logger?.debug(
        `[Strategie] Daedalus-Vorbereitung (Combat: ${minCombat}, Hack: ${player.skills.hacking}) ➔ ${targetMode}`,
      );
      return isCombatFaster
        ? { mode: "TRAIN", targetStat: 1500 }
        : { mode: "UNI", targetStat: 2500 };
    }
  }

  // 6. Standard Money Mode
  return { mode: "MONEY" };
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
