import { NS, Player, FactionName, CompanyName } from "@ns";
import { BotStrategy, StrategyResult, TargetFactionResult } from "../core/types.js";
import { MEGACORPS, HACKING_FACTIONS, COMBAT_FACTION_REQUIREMENTS } from "./constants.js";



export function determineStrategy(
  ns: NS,
  p: Player,
  currentState: any,
  bnMults: any,
  currentKarma: number,
  canRunBatcher: boolean,
  factionTargets: Record<FactionName, number>,
  nextRoadmapFaction: TargetFactionResult | null,
  factionToWorkFor: TargetFactionResult | null,
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

  // N niedrigster Kampfwert des Spielers ermitteln (Str, Def, Dex, Agi)
  const minCombatSkill = Math.min(
    p.skills.strength,
    p.skills.defense,
    p.skills.dexterity,
    p.skills.agility
  );

  // Default-Zuweisung für Target-Faction, falls im Roadmap-Modus
  if (roadmapFactionName && p.factions.includes(roadmapFactionName)) {
    targetFaction = roadmapFactionName;
  }

  // --- ENTSCHEIDUNGSBAUM ---
  if (p.skills.hacking < 50) {
    mode = "MONEY";
  } else if (nextRoadmapFaction && roadmapFactionName) {
    const isMember = p.factions.includes(roadmapFactionName);
    const isCombatFaction = [
      "Slum Snakes",
      "Tetrads",
      "The Syndicate",
      "The Dark Army",
      "Speakers for the Dead",
    ].includes(roadmapFactionName);

    if (!isMember) {
      targetFaction = roadmapFactionName;
      const requiredCombatStat = COMBAT_FACTION_REQUIREMENTS[roadmapFactionName] ?? 0;

      // 🏋️ 1. Prüfen, ob Kampfwerte trainiert werden müssen
      if (requiredCombatStat > 0 && minCombatSkill < requiredCombatStat) {
        mode = "TRAIN";
        targetStat = requiredCombatStat;
      }
      // 🔫 2. Prüfen, ob Karma oder Kills fehlen
      else if (roadmapFactionName === "Slum Snakes" && currentKarma > -9) {
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
      } else {
        mode = "MONEY";
      }
    } else {
      // Wenn wir bereits Mitglied sind -> direkt Reputational Grind starten!
      if (isReadyForFactionGrind || isCombatFaction) {
        mode = "REP";
        targetFaction = roadmapFactionName;
      } else {
        mode = "MONEY";
      }
    }
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
  } else if (homeMaxRam < 256 || !canRunBatcher || crimeMoneyMult > 5) {
    mode = "CRIME";
  } else {
    mode = "MONEY";
  }

  return { mode, targetFaction, targetCompany, targetStat };
}