import { NS, Player, FactionName } from "@ns";
import {
  FactionConfig,
  CITY_FACTIONS,
  HACKING_FACTIONS,
  MEGACORPS,
} from "./constants.js";
import { Logger } from "../core/logger.js";

/**
 * Evaluiert die nächste Fraktion auf der Roadmap, die noch Rep-Bedarf hat.
 */
/**
 * Evaluiert die nächste Fraktion auf der Roadmap, die noch Rep-Bedarf hat.
 * Berücksichtigt ausschließlich Fraktionen, bei denen wir bereits Mitglied sind.
 */
export function findNextRoadmapFaction(
  p: Player,
  factionReps: Record<string, number>,
  factionTargets: Record<string, number>,
): FactionConfig | null {
  for (const faction of HACKING_FACTIONS) {
    // 🟢 Fix 1: Wir können nur für Fraktionen arbeiten, bei denen wir bereits Mitglied sind!
    // Falls wir kein Mitglied sind, überspringen wir sie für das aktive Farming.
    if (!p.factions.includes(faction.name)) {
      continue;
    }

    // 🟢 Fix 2: Sobald wir Mitglied sind, ist der Stadt-Sperren-Check hinfällig.
    // Bitburner erlaubt es, für jede beigetretene Fraktion remote zu arbeiten,
    // ganz ohne Reisekosten oder Standort-Einschränkungen.
    // Der alte "continue"-Block an dieser Stelle entfällt daher komplett.

    const repNeeded = factionTargets[faction.name] ?? 0;
    if (repNeeded > 0) {
      const currentRep = factionReps[faction.name] ?? 0;

      // Wenn der aktuelle Rufwert kleiner als das Ziel ist, ist dies unsere Arbeits-Fraktion
      if (currentRep < repNeeded) {
        return faction;
      }
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
