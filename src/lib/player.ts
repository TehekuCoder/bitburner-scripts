import { NS, Player, FactionName } from "@ns";
import { FactionConfig, CITY_FACTIONS, HACKING_FACTIONS, MEGACORPS } from "./constants.js";
import { Logger } from "../core/logger.js";

/**
 * Evaluiert die nächste Fraktion auf der Roadmap, die noch Rep-Bedarf hat.
 */
export function findNextRoadmapFaction(
  p: Player,
  factionReps: Record<string, number>,
  factionTargets: Record<string, number>,
): FactionConfig | null {
  const currentCityFaction = p.factions.find((f) =>
    CITY_FACTIONS.includes(f as FactionName),
  );

  for (const faction of HACKING_FACTIONS) {
    if (CITY_FACTIONS.includes(faction.name)) {
      if (currentCityFaction && faction.name !== currentCityFaction) {
        continue; // Keine fremden Städte anfliegen, wenn wir schon in einer sind
      }
    }

    const repNeeded = factionTargets[faction.name] ?? 0;
    if (repNeeded > 0) {
      const currentRep = p.factions.includes(faction.name)
        ? (factionReps[faction.name] ?? 0)
        : 0;
      if (currentRep < repNeeded) return faction;
    }
  }
  return null;
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