import { NS, Player, FactionName, CompanyName, BitNodeMultipliers } from "@ns";
import { MEGACORPS, GANG_CANDIDATE_FACTIONS } from "../../shared/constants/factions.js";
import { AugmentTarget, TargetFactionResult } from "/shared/types/factions.js";
import { COMBAT_STATS } from "/shared/types/game.js";
import { BotState, StrategyResult } from "/shared/types/strategy.js";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { loadBnMults, hasSingularity } from "/lib/utils.js";

const MEGACORP_FACTION_TO_COMPANY: Record<string, CompanyName> = {
  ECorp: "ECorp" as CompanyName,
  MegaCorp: "MegaCorp" as CompanyName,
  "Bachman & Associates": "Bachman & Associates" as CompanyName,
  "Blade Industries": "Blade Industries" as CompanyName,
  NWO: "NWO" as CompanyName,
  "Clarke Incorporated": "Clarke Incorporated" as CompanyName,
  "OmniTek Incorporated": "OmniTek Incorporated" as CompanyName,
  "Four Sigma": "Four Sigma" as CompanyName,
  "KuaiGong International": "KuaiGong International" as CompanyName,
  "Fulcrum Secret Technologies": "Fulcrum Technologies" as CompanyName,
};

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
  logger?: LoggerClient,
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

  const isPendingGangUnlock = !ns.gang?.inGang() && player.karma <= -54000;

  const relevantTargets = getNonGangRoadmapTargets(
    ns,
    augRoadmap,
    gangFaction ?? null,
  );

  const nonDaedalusTargets = relevantTargets.filter(
    (t) => !t.factions.includes("Daedalus") && t.name !== "The Red Pill",
  );

  for (const target of nonDaedalusTargets) {
    const validFactions = target.factions.filter((f) => {
      if (f === "Shadows of Anarchy") return false;
      if (f === gangFaction && !isBN2) return false;

      if (
        isPendingGangUnlock &&
        GANG_CANDIDATE_FACTIONS.includes(f as FactionName)
      ) {
        return false;
      }

      return playerFactions.includes(f) || invites.includes(f);
    });

    if (validFactions.length > 0) {
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
          isCompany: false,
        };
      }
      continue;
    }

    for (const f of target.factions) {
      if (f === "Shadows of Anarchy" || (f === gangFaction && !isBN2)) continue;

      if (
        isPendingGangUnlock &&
        GANG_CANDIDATE_FACTIONS.includes(f as FactionName)
      )
        continue;

      const companyName = MEGACORP_FACTION_TO_COMPANY[f];
      if (companyName) {
        const companyRep = ns.singularity.getCompanyRep(companyName);
        const reqCompanyRep =
          companyName === ("Fulcrum Technologies" as CompanyName)
            ? 250_000
            : 400_000;

        if (companyRep < reqCompanyRep) {
          return {
            name: f as FactionName,
            targetRep: target.repReq,
            augName: target.name,
            isNFG: target.name.includes("NeuroFlux Governor"),
            isCompany: true,
            companyName: companyName,
          };
        }
      }
    }
  }

  const bnMults = loadBnMults(ns);

  const hasDaedalus =
    playerFactions.includes("Daedalus") || invites.includes("Daedalus");
  if (hasDaedalus && !redPillOwned) {
    const daedalusTarget = augRoadmap.find(
      (t) => t.factions.includes("Daedalus") || t.name === "The Red Pill",
    );
    const targetRep = daedalusTarget
      ? daedalusTarget.repReq
      : 2_500_000 * (bnMults.AugmentationRepCost ?? 1);
    const currentRep = ns.singularity.getFactionRep("Daedalus");

    if (currentRep < targetRep) {
      return {
        name: "Daedalus",
        targetRep,
        augName: daedalusTarget?.name ?? "The Red Pill",
        isNFG: false,
        isCompany: false,
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
  isDominionEtaReady: boolean = false,
  logger?: LoggerClient,
): StrategyResult {
  const EARLY_FACTIONS: FactionName[] = [
    "CyberSec",
    "Tian Di Hui",
    "Netburners",
  ];

  const hackExpMult = bnMults.HackExpGain ?? 1;
  const reqDaedalusAugs = Math.floor(30 * (bnMults.DaedalusAugsRequirement ?? 1));
  const hasGang = currentState?.hasGang || (ns.gang?.inGang() ?? false);
  const redPillOwned = hasRedPill(ns);
  const daedalusRep = player.factions.includes("Daedalus")
    ? ns.singularity.getFactionRep("Daedalus")
    : 0;

  const daedalusDone =
    redPillOwned ||
    daedalusRep >= 2_500_000 * (bnMults.AugmentationRepCost ?? 1);

  // 1️⃣ BASIC HACKING LEVELING
  const targetHackLevel = hackExpMult < 0.25 ? 15 : 30;
  if (player.skills.hacking < targetHackLevel) {
    logger?.debug(`[Strategie] Hacking < ${targetHackLevel} ➔ UNI`);
    return { mode: "UNI", targetStat: targetHackLevel };
  }

  // 2️⃣ DAEDALUS SOFORT-REP (Red Pill Ziel hat immer Höchstpriorität)
  if (player.factions.includes("Daedalus") && !daedalusDone) {
    const daedalusTargetRep =
      factionTargets["Daedalus"] ??
      2_500_000 * (bnMults.AugmentationRepCost ?? 1);
    if (daedalusRep < daedalusTargetRep) {
      logger?.debug(
        `[Strategie] Daedalus Priorität aktiv (${Math.round(daedalusRep)}/${daedalusTargetRep} Rep) ➔ REP`,
      );
      return { mode: "REP", targetFaction: "Daedalus" as FactionName };
    }
  }

  // 3️⃣ PHASE 1: Early-Game Fraktionen (CyberSec, etc.)
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

  // 5️⃣ PHASE 3: Vor-Daedalus Stat-Grind
  if (
    !player.factions.includes("Daedalus") &&
    !daedalusDone &&
    !factionToWorkFor
  ) {
    const installedAugs = ns.singularity.getOwnedAugmentations(false).length;
    if (installedAugs >= reqDaedalusAugs || player.money >= 100e9) {
      const minCombat = Math.min(...COMBAT_STATS.map((s) => player.skills[s]));
      const hasCombatReq = minCombat >= 1500;
      const hasHackReq = player.skills.hacking >= 2500;

      if (!hasCombatReq && !hasHackReq) {
        const isCombatFaster =
          hackExpMult < 0.3 ||
          (minCombat >= 800 && player.skills.hacking < 1800);
        const targetMode = isCombatFaster ? "TRAIN" : "UNI";
        logger?.debug(
          `[Strategie] Daedalus-Vorbereitung (Combat: ${minCombat}/1500, Hack: ${player.skills.hacking}/2500) ➔ ${targetMode}`,
        );
        return isCombatFaster
          ? { mode: "TRAIN", targetStat: 1500 }
          : { mode: "UNI", targetStat: 2500 };
      }
    }
  }

  // 6️⃣ PHASE 4: BLADEBURNER (Nur ohne Simulacrum als eigenständiger Mode)
  try {
    if (typeof ns.bladeburner !== "undefined") {
      if (!ns.bladeburner.inBladeburner()) {
        const minCombat = Math.min(...COMBAT_STATS.map((s) => player.skills[s]));
        if (minCombat >= 100) {
          if (ns.bladeburner.joinBladeburnerDivision()) {
            logger?.info("⚔️ Bladeburner Division erfolgreich beigetreten!");
          }
        }
      }

      // Mit The Blade's Simulacrum läuft Bladeburner als Parallel-System (kein Mode-Override).
      // Ohne Simulacrum wird Bladeburner zum alleinigen Focus-Mode.
      if (ns.bladeburner.inBladeburner()) {
        const hasSimulacrum =
          hasSingularity(ns) &&
          ns.singularity
            .getOwnedAugmentations(false)
            .includes("The Blade's Simulacrum");

        if (!hasSimulacrum) {
          logger?.debug(
            `[Strategie] Bladeburner System Aktiv (ohne Simulacrum) ➔ BLADEBURNER (exklusiv)`,
          );
          return { mode: "BLADEBURNER" };
        } else {
          logger?.debug(
            `[Strategie] Bladeburner aktiv mit Simulacrum ➔ Läuft parallel zu anderen Strategien`,
          );
        }
      }
    }
  } catch {}

  // 7️⃣ PHASE 5: Roadmap-Fraktionen oder Firmen-Grind
  if (factionToWorkFor && isReadyForFactionGrind) {
    if (factionToWorkFor.isCompany && factionToWorkFor.companyName) {
      logger?.debug(
        `[Strategie] Megacorp-Ruf farmen für ${factionToWorkFor.companyName} (${factionToWorkFor.augName}) ➔ COMPANY`,
      );
      return {
        mode: "COMPANY",
        targetCompany: factionToWorkFor.companyName as CompanyName,
      };
    }

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

  // 8️⃣ PHASE 6: CHURCH OF THE MACHINE GOD / STANEK (SF13)
  try {
    if (ns.serverExists("church") && ns.stanek?.activeFragments().length > 0) {
      logger?.debug(`[Strategie] Stanek Fragment Charge/Church Grind ➔ CHURCH`);
      return { mode: "CHURCH" };
    }
  } catch {}

  // 9️⃣ PHASE 7: WORLD DOMINATION
  const isDominionActive =
    currentState?.isDominionActive ||
    redPillOwned ||
    (daedalusDone && isDominionEtaReady);

  if (isDominionActive) {
    let worldDaemonReq = Math.floor(
      3000 * (bnMults.WorldDaemonDifficulty ?? 1),
    );
    try {
      if (ns.serverExists("w0r1d_d43m0n")) {
        worldDaemonReq = ns.getServerRequiredHackingLevel("w0r1d_d43m0n");
      }
    } catch {}

    logger?.debug(
      `[Strategie] 🌐 DOMINION Modus aktiv: Hacking Push (${player.skills.hacking}/${worldDaemonReq}) ➔ DOMINION`,
    );
    return { mode: "DOMINION", targetStat: worldDaemonReq };
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

export function isReadyForDaedalus(
  ns: NS,
  player: Player,
  bnMults?: BitNodeMultipliers,
): boolean {
  const mults = bnMults ?? loadBnMults(ns);
  const reqAugs = Math.floor(30 * (mults.DaedalusAugsRequirement ?? 1));
  const installedAugs = ns.singularity.getOwnedAugmentations(false).length;
  const hasMoney = player.money >= 100e9;
  const hasSkill =
    player.skills.hacking >= 2500 ||
    COMBAT_STATS.every((s) => player.skills[s] >= 1500);

  return installedAugs >= reqAugs && hasMoney && hasSkill;
}