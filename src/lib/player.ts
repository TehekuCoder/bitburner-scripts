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

export function hasRedPill(ns: NS): boolean {
  try {
    return ns.singularity.getOwnedAugmentations(true).includes("The Red Pill");
  } catch {
    return false;
  }
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

export function getGangAugmentations(
  ns: NS,
  gangFaction: string | null,
): Set<string> {
  const gangAugs = new Set<string>();
  if (gangFaction && ns.gang?.inGang()) {
    try {
      const augs = ns.singularity.getAugmentationsFromFaction(
        gangFaction as FactionName,
      );
      augs.forEach((a) => gangAugs.add(a));
    } catch {}
  }
  return gangAugs;
}

export function getNonGangRoadmapTargets(
  ns: NS,
  augRoadmap: AugmentTarget[],
  gangFaction: string | null,
): AugmentTarget[] {
  const gangAugs = getGangAugmentations(ns, gangFaction);
  if (gangAugs.size === 0) return augRoadmap;

  return augRoadmap.filter((target) => !gangAugs.has(target.name));
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
  const redPillOwned = hasRedPill(ns);

  // 1️⃣ DAEDALUS PRIORITÄT (Red Pill immer bevorzugen)
  const hasDaedalus =
    playerFactions.includes("Daedalus") || invites.includes("Daedalus");
  if (hasDaedalus && !redPillOwned) {
    const daedalusTarget = augRoadmap.find(
      (t) => t.factions.includes("Daedalus") || t.name === "The Red Pill",
    );
    const targetRep = daedalusTarget ? daedalusTarget.repReq : 2_500_000;
    const currentRep = ns.singularity.getFactionRep("Daedalus");

    if (currentRep < targetRep) {
      return {
        name: "Daedalus",
        targetRep,
        augName: daedalusTarget?.name ?? "The Red Pill",
        isNFG: false,
      };
    }
  }

  // 2️⃣ Nur Targets betrachten, die die Gang NICHT anbietet
  const relevantTargets = getNonGangRoadmapTargets(
    ns,
    augRoadmap,
    gangFaction ?? null,
  );

  for (const target of relevantTargets) {
    if (
      isBN2 &&
      !hasDaedalus &&
      !redPillOwned &&
      target.name !== "The Red Pill"
    ) {
      continue;
    }

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
  logger?: Logger,
): StrategyResult {
  const hackExpMult = bnMults.HackExpGain ?? 1;
  const hasGang = currentState?.hasGang || (ns.gang?.inGang() ?? false);
  const redPillOwned = hasRedPill(ns);
  const daedalusRep = player.factions.includes("Daedalus")
    ? ns.singularity.getFactionRep("Daedalus")
    : 0;
  const daedalusDone = redPillOwned || daedalusRep >= 2_500_000;

  // 1️⃣ BASIC HACKING LEVELING
  const targetHackLevel = hackExpMult < 0.25 ? 15 : 30;
  if (player.skills.hacking < targetHackLevel) {
    logger?.debug(`[Strategie] Hacking < ${targetHackLevel} ➔ UNI`);
    return { mode: "UNI", targetStat: targetHackLevel };
  }

  // 2️⃣ DAEDALUS SOFORT-REP (Red Pill Ziel)
  if (player.factions.includes("Daedalus") && !daedalusDone) {
    const daedalusTargetRep = factionTargets["Daedalus"] ?? 2_500_000;
    if (daedalusRep < daedalusTargetRep) {
      logger?.debug(
        `[Strategie] Daedalus Priorität aktiv (${Math.round(daedalusRep)}/${daedalusTargetRep} Rep) ➔ REP`,
      );
      return { mode: "REP", targetFaction: "Daedalus" as FactionName };
    }
  }

  // 3️⃣ PHASE 1: Early-Game Fraktionen (CyberSec, Netburners, Tian Di Hui)
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

  // 4️⃣ PHASE 2: KARMA RUSH FÜR GANG-UNLOCK
  const hasSleeves = (ns.sleeve?.getNumSleeves() ?? 0) > 0;
  if (!hasGang && currentKarma > -54000 && !hasSleeves) {
    const minCombat = Math.min(...COMBAT_STATS.map((s) => player.skills[s]));
    if (minCombat < 30) {
      logger?.debug(
        `[Strategie] Combat zu niedrig für Karma-Grind (${minCombat}/30) ➔ TRAIN`,
      );
      return { mode: "TRAIN", targetStat: 30 };
    }
    logger?.debug(
      `[Strategie] Gang-Vorbereitung (Karma: ${Math.round(currentKarma)} / -54000) ➔ KARMA`,
    );
    return { mode: "KARMA" };
  }

  // 5️⃣ PHASE 3: Vor-Daedalus Stat-Grind (Falls Einladungsvoraussetzungen fehlen)
  if (!player.factions.includes("Daedalus") && !daedalusDone) {
    const installedAugs = ns.singularity.getOwnedAugmentations(false).length;
    if (installedAugs >= 25) {
      const minCombat = Math.min(...COMBAT_STATS.map((s) => player.skills[s]));
      const hasCombatReq = minCombat >= 1500;
      const hasHackReq = player.skills.hacking >= 2500;

      if (!hasCombatReq && !hasHackReq) {
        const isCombatFaster =
          hackExpMult < 0.3 ||
          (minCombat >= 800 && player.skills.hacking < 1800);
        const targetMode = isCombatFaster ? "TRAIN" : "UNI";
        logger?.debug(
          `[Strategie] Daedalus-Vorbereitung (Combat: ${minCombat}, Hack: ${player.skills.hacking}) ➔ ${targetMode}`,
        );
        return isCombatFaster
          ? { mode: "TRAIN", targetStat: 1500 }
          : { mode: "UNI", targetStat: 2500 };
      }
    }
  }

  // 6️⃣ PHASE 4: Nicht-Gang Fraktionen aus der Roadmap farmen
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
  // 7️⃣ PHASE 5: CHURCH OF THE MACHINE GOD / STANEK (SF13)
  try {
    if (ns.serverExists("church") && ns.stanek?.activeFragments().length > 0) {
      logger?.debug(`[Strategie] Stanek Fragment Charge/Church Grind ➔ CHURCH`);
      return { mode: "CHURCH" };
    }
  } catch {}

  // 8️⃣ PHASE 6: BLADEBURNER (SF7)
  try {
    if (ns.bladeburner?.inBladeburner()) {
      logger?.debug(`[Strategie] Bladeburner System Aktiv ➔ BLADEBURNER`);
      return { mode: "BLADEBURNER" };
    }
  } catch {}

  // 9️⃣ PHASE 7: WORLD DOMINATION (Red Pill installiert, Push für w0r1d_d43m0n)
  if (daedalusDone) {
    let worldDaemonReq = 3000;
    try {
      worldDaemonReq = ns.getServerRequiredHackingLevel("w0r1d_d43m0n");
    } catch {}

    if (player.skills.hacking < worldDaemonReq) {
      logger?.debug(
        `[Strategie] 🌐 World Domination: Hacking Push (${player.skills.hacking}/${worldDaemonReq}) ➔ UNI`,
      );
      return { mode: "UNI", targetStat: worldDaemonReq };
    }
  }

  // 🔟 FALLBACK: MONEY
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
