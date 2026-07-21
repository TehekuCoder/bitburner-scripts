import { NS, Player, FactionName, CompanyName } from "@ns";
import { BotStrategy,StrategyResult } from "/core/types.js";
import { COMBAT_STATS, MEGACORPS, HACKING_FACTIONS } from "./constants.js";



export function determineStrategy(
  ns: NS,
  p: Player,
  currentState: any,
  bnMults: any,
  currentKarma: number,
  isRushActive: boolean,
  canRunBatcher: boolean,
  factionTargets: Record<FactionName, number>,
  nextRoadmapFaction: { name: FactionName; minStat: number } | null,
  factionToWorkFor: any,
  isReadyForFactionGrind: boolean
): StrategyResult {
  let mode: BotStrategy = "MONEY";
  let targetFaction: FactionName | null = null;
  let targetCompany: CompanyName | undefined = undefined;
  let targetStat = 0;

  const roadmapFactionName = nextRoadmapFaction ? nextRoadmapFaction.name : null;
  const companyRepMult = bnMults.CompanyWorkRepGain ?? 1;
  const crimeMoneyMult = bnMults.CrimeMoney ?? 1;
  const homeMaxRam = ns.getServerMaxRam("home");

  // Default-Zuweisung für Target-Faction, falls im Roadmap-Modus
  if (roadmapFactionName && p.factions.includes(roadmapFactionName)) {
    targetFaction = roadmapFactionName;
  }

  // --- ENTSCHEIDUNGSBAUM ---
  if (p.skills.hacking < 50) {
    mode = "MONEY";
  } else if (nextRoadmapFaction && roadmapFactionName) {
    const isMember = p.factions.includes(roadmapFactionName);
    const isCombatFaction =
      nextRoadmapFaction.minStat > 0 ||
      [
        "Slum Snakes",
        "Tetrads",
        "The Syndicate",
        "The Dark Army",
        "Speakers for the Dead",
      ].includes(roadmapFactionName);

    if (!isMember) {
      targetFaction = roadmapFactionName;

      if (roadmapFactionName === "Slum Snakes" && currentKarma > -9) {
        mode = "CRIME";
      } else if (roadmapFactionName === "Tetrads" && currentKarma > -18) {
        mode = "CRIME";
      } else if (roadmapFactionName === "The Syndicate" && currentKarma > -90) {
        mode = "CRIME";
      } else if (roadmapFactionName === "The Dark Army" && p.numPeopleKilled < 5) {
        mode = "KILLS";
        targetStat = 5;
      } else if (roadmapFactionName === "Speakers for the Dead" && p.numPeopleKilled < 30) {
        mode = "KILLS";
        targetStat = 30;
      } else if (
        nextRoadmapFaction.minStat > 0 &&
        Math.min(...COMBAT_STATS.map((s) => p.skills[s])) < nextRoadmapFaction.minStat
      ) {
        mode = "TRAIN";
        targetStat = nextRoadmapFaction.minStat;
      } else if (isRushActive) {
        mode = "MONEY";
      } else {
        mode = "MONEY";
      }
    } else {
      if (isReadyForFactionGrind || isCombatFaction) {
        mode = "REP";
        targetFaction = roadmapFactionName;
        targetStat = nextRoadmapFaction.minStat;
      } else if (isRushActive) {
        mode = "MONEY";
      } else {
        mode = "MONEY";
      }
    }
  } else if (isRushActive) {
    mode = "MONEY";
  } else if (p.skills.hacking >= 250 && companyRepMult > 0.1) {
    const needsSilhouette =
      !p.factions.includes("Silhouette" as FactionName) &&
      (factionTargets["Silhouette"] ?? 0) > 0;
    const isExecutive = Object.values(p.jobs).some((title) =>
      [
        "Chief Technology Officer",
        "Chief Financial Officer",
        "Chief Executive Officer",
      ].includes(title)
    );
    const hasEnoughKarma = currentKarma <= -22;

    if (needsSilhouette && (!isExecutive || !hasEnoughKarma)) {
      if (!hasEnoughKarma) {
        mode = "CRIME";
      } else {
        mode = "CORP";
        const currentCorpJob = Object.keys(p.jobs).find(
          (corp) => MEGACORPS[corp] !== undefined
        );
        targetCompany = currentCorpJob
          ? MEGACORPS[currentCorpJob]
          : Object.values(MEGACORPS)[0];
      }
    } else {
      const missingCorpFaction = HACKING_FACTIONS.find(
        (f) =>
          !p.factions.includes(f.name) &&
          MEGACORPS[f.name] !== undefined &&
          ns.singularity.getCompanyRep(MEGACORPS[f.name]) < 400_000 &&
          (factionTargets[f.name] ?? 0) > 0
      );

      if (missingCorpFaction) {
        mode = "CORP";
        targetCompany = MEGACORPS[missingCorpFaction.name];
      } else {
        mode = canRunBatcher ? "MONEY" : "CRIME";
      }
    }
  } else if (homeMaxRam < 256 || !canRunBatcher || (crimeMoneyMult > 5)) {
    mode = "CRIME";
  } else {
    mode = "MONEY";
  }

  // Fallback-Prüfung für Combat Faction Fokus
  if (mode === "MONEY" && ns.cloud.getServerNames().length > 0) {
    const FOCUS_ON_COMBAT_FACTIONS = false; // Kann dynamisch gesteuert werden

    if (FOCUS_ON_COMBAT_FACTIONS) {
      const nextLockedCombatFaction = HACKING_FACTIONS.find(
        (f) => !p.factions.includes(f.name) && f.minStat > 0
      );

      if (nextLockedCombatFaction) {
        let requiredKills = 0;
        if (nextLockedCombatFaction.name === "The Dark Army") requiredKills = 5;
        if (nextLockedCombatFaction.name === "Speakers for the Dead") requiredKills = 30;

        const currentLowestCombatStat = Math.min(
          ...COMBAT_STATS.map((s) => p.skills[s])
        );

        if (p.numPeopleKilled < requiredKills) {
          mode = "KILLS";
          targetStat = requiredKills;
          targetFaction = nextLockedCombatFaction.name;
        } else if (currentLowestCombatStat < nextLockedCombatFaction.minStat) {
          mode = "TRAIN";
          targetStat = nextLockedCombatFaction.minStat;
          targetFaction = nextLockedCombatFaction.name;
        }
      }
    }
  }

  return { mode, targetFaction, targetCompany, targetStat };
}