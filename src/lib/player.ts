import { NS, Player } from "@ns";
import { MEGACORPS } from "./constants.js";
import { Logger } from "../core/logger.js";
import { TargetFactionResult, AugmentTarget } from "/core/types.js";

/**
 * Evaluiert die nächste Fraktion auf der Roadmap, die noch Rep-Bedarf hat.
 */
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
