import { NS, Player, FactionName, CompanyName } from "@ns";
import {
  MEGACORPS,
  HACKING_FACTIONS,
  COMBAT_FACTION_REQUIREMENTS,
} from "./constants.js";
import { Logger } from "./logger.js";
import {
  TargetFactionResult,
  AugmentTarget,
  BotStrategy,
  StrategyResult,
} from "./types.js";

/**
 * Evaluiert die nächste Fraktion auf der Roadmap, die noch Rep-Bedarf hat.
 * Berücksichtigt ausschließlich Fraktionen, bei denen wir bereits Mitglied sind.
 */
export function findNextRoadmapFaction(
  ns: NS,
  augRoadmap: AugmentTarget[] = [],
): TargetFactionResult | null {
  const playerFactions = ns.getPlayer().factions;

  for (const target of augRoadmap) {
    // Prüfe nur Fraktionen, bei denen wir bereits Mitglied sind
    const validFactions = target.factions.filter((f) =>
      playerFactions.includes(f),
    );
    if (validFactions.length === 0) continue;

    // Finde unter deinen beigetretenen Fraktionen die mit der höchsten Rep
    let bestFaction = validFactions[0];
    let maxRep = ns.singularity.getFactionRep(bestFaction);

    for (const f of validFactions) {
      const rep = ns.singularity.getFactionRep(f);
      if (rep > maxRep) {
        maxRep = rep;
        bestFaction = f;
      }
    }

    // Wenn der Ruf für dieses Augment noch NICHT reicht -> Das ist unser nächstes Grind-Ziel!
    if (maxRep < target.repReq) {
      return {
        name: bestFaction,
        targetRep: target.repReq,
        augName: target.name,
      };
    }
  }

  return null; // Alle erreichbaren Augments der beigetretenen Fraktionen wurden gefarmt!
}

/**
 * Bewirbt sich automatisch bei allen Megacorps als Software-Entwickler.
 */
export function applyToAllMegacorps(ns: NS, p: Player, logger: Logger): void {
  for (const corpName of Object.values(MEGACORPS)) {
    if (!p.jobs[corpName]) {
      if (ns.singularity.applyToCompany(corpName, "Software")) {
        logger.success(
          `💼 Bewerbung erfolgreich: Anstellung bei '${corpName}' erhalten.`,
        );
      }
    }
  }
}

/**
 * Legt fest, was der Spieler machen soll
 */
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
  isReadyForFactionGrind: boolean,
): StrategyResult {
  let mode: BotStrategy = "MONEY";
  let targetFaction: FactionName | null = null;
  let targetCompany: CompanyName | undefined = undefined;
  let targetStat = 0;

  const roadmapFactionName = nextRoadmapFaction
    ? nextRoadmapFaction.name
    : null;
  const companyRepMult = bnMults.CompanyWorkRepGain ?? 1;
  const crimeMoneyMult = bnMults.CrimeMoney ?? 1;
  const homeMaxRam = ns.getServerMaxRam("home");

  // N niedrigster Kampfwert des Spielers ermitteln (Str, Def, Dex, Agi)
  const minCombatSkill = Math.min(
    p.skills.strength,
    p.skills.defense,
    p.skills.dexterity,
    p.skills.agility,
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
    const isCombatFaction = roadmapFactionName in COMBAT_FACTION_REQUIREMENTS;

    if (!isMember) {
      targetFaction = roadmapFactionName;
      const requiredCombatStat =
        COMBAT_FACTION_REQUIREMENTS[roadmapFactionName] ?? 0;

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
      } else if (
        roadmapFactionName === "The Dark Army" &&
        p.numPeopleKilled < 5
      ) {
        mode = "KILLS";
        targetStat = 5;
      } else if (
        roadmapFactionName === "Speakers for the Dead" &&
        p.numPeopleKilled < 30
      ) {
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
      ].includes(title),
    );
    const hasEnoughKarma = currentKarma <= -22;

    if (needsSilhouette && (!isExecutive || !hasEnoughKarma)) {
      if (!hasEnoughKarma) {
        mode = "CRIME";
      } else {
        mode = "CORP";
        const currentCorpJob = Object.keys(p.jobs).find(
          (corp) => MEGACORPS[corp] !== undefined,
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
          (factionTargets[f.name] ?? 0) > 0,
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

/**
 * Ermittelt alle gekauften, aber noch nicht installierten Augmentations.
 * Verhindert Fehleinsteufe / Kausalitätsfehler bei Neustart-Skripten.
 */
export function getPurchasedUninstalledAugs(ns: NS): string[] {
  const allOwned = ns.singularity.getOwnedAugmentations(true);
  const installed = ns.singularity.getOwnedAugmentations(false);

  return allOwned.filter((aug) => !installed.includes(aug));
}

/**
 * Prüft, ob seit dem letzten Reset bereits irgendwelche Augmentations gekauft wurden.
 */
export function hasPurchasedAugsThisRun(ns: NS): boolean {
  return getPurchasedUninstalledAugs(ns).length > 0;
}