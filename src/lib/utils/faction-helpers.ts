import { NS, FactionName } from "@ns";
import { NFG_WHITELIST_CONFIG } from "../../shared/constants/factions";
import { GangState } from "shared/types/gang";
import { CITY_FACTIONS } from "../../shared/constants/factions";

/**
 * Gibt die aktuelle City-Fraktion zurück, in der der Spieler Mitglied ist (falls vorhanden).
 */
export function getCurrentCityFaction(ns: NS): FactionName | null {
  const playerFactions = ns.getPlayer().factions as FactionName[];
  return CITY_FACTIONS.find((city) => playerFactions.includes(city)) ?? null;
}

/**
 * Prüft, ob eine Fraktion beigetreten werden KANN (schützt vor City-Exclusion).
 */
export function canJoinFaction(ns: NS, targetFaction: FactionName): boolean {
  // Keine City-Fraktion? Dann gibt es keine Sperre.
  if (!CITY_FACTIONS.includes(targetFaction)) return true;

  const currentCity = getCurrentCityFaction(ns);
  // Beitritt möglich wenn: Noch in keiner Stadt ODER bereits in genau dieser Stadt
  return currentCity === null || currentCity === targetFaction;
}

/**
 * Bestimmt die optimale NFG-Spender-Fraktion abhängig vom aktuellen Gang-Typ.
 */
export function getNFGFallbackFaction(ns: NS, gangState: GangState | null): FactionName {
  if (gangState?.hasGang) {
    const gangFaction = gangState.gangFaction;

    if (gangState.isHackingGang) {
      // Hacking-Gang (z.B. CyberSec / NiteSec / BitRunners) -> Wähle Slum Snakes
      // Falls die Hacking-Gang wider Erwarten Slum Snakes wäre (nicht möglich), Fallback.
      return gangFaction === NFG_WHITELIST_CONFIG.hackingGangDefault
        ? ("CyberSec" as FactionName)
        : NFG_WHITELIST_CONFIG.hackingGangDefault;
    } else {
      // Combat-Gang (z.B. Slum Snakes / Tetrads / Syndicate) -> Wähle CyberSec
      return gangFaction === NFG_WHITELIST_CONFIG.combatGangDefault
        ? ("Slum Snakes" as FactionName)
        : NFG_WHITELIST_CONFIG.combatGangDefault;
    }
  }

  // Falls keine Gang aktiv ist, Standard CyberSec nehmen
  return NFG_WHITELIST_CONFIG.combatGangDefault;
}