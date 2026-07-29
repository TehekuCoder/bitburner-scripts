import { NS, FactionName } from "@ns";
import { CITY_FACTIONS } from "/lib/constants.js";

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