import { BladeburnerActionName, NS } from "@ns";

export const CITIES = [
  "Aevum",
  "Chongqing",
  "Sector-12",
  "New Tokyo",
  "Ishima",
  "Volhaven",
] as const;

export type BladeburnerCity = (typeof CITIES)[number];

export interface ChaosStatus {
  hasHighChaos: boolean;
  targetCity: BladeburnerCity | null;
  highestChaos: number;
  activeThreshold: number;
}

/**
 * Berechnet eine dynamische Chaos-Schwelle basierend auf der minimalen
 * Erfolgschance für Verträge.
 */
export function calculateDynamicThreshold(ns: NS, targetMinChance = 0.85): number {
  if (!ns.bladeburner || !ns.bladeburner.inBladeburner()) return 50;

  const contracts: BladeburnerActionName[] = ["Tracking", "Bounty Hunter", "Retirement"];
  let lowestChance = 1.0;

  for (const contract of contracts) {
    const chance = ns.bladeburner.getActionEstimatedSuccessChance("Contracts", contract);
    const minChance = chance[0]; // Untere Spanne der Erfolgschance
    if (minChance < lowestChance) {
      lowestChance = minChance;
    }
  }

  // Erfolgschance schlecht (<85%) -> Chaos streng begrenzen (ab 15)
  // Erfolgschance moderat (85-95%) -> Moderates Limit (40)
  // Erfolgschance perfekt (>95%) -> Höheres Chaos tolerieren (75)
  if (lowestChance < targetMinChance) {
    return 15;
  } else if (lowestChance < 0.95) {
    return 40;
  }
  return 75;
}

export function getChaosStatus(ns: NS, targetMinChance = 0.85): ChaosStatus {
  if (!ns.bladeburner || !ns.bladeburner.inBladeburner()) {
    return { hasHighChaos: false, targetCity: null, highestChaos: 0, activeThreshold: 50 };
  }

  const threshold = calculateDynamicThreshold(ns, targetMinChance);
  let highestChaos = 0;
  let targetCity: BladeburnerCity | null = null;

  for (const city of CITIES) {
    const chaos = ns.bladeburner.getCityChaos(city);
    if (chaos > highestChaos) {
      highestChaos = chaos;
    }
    if (chaos > threshold && (!targetCity || chaos > ns.bladeburner.getCityChaos(targetCity))) {
      targetCity = city;
    }
  }

  return {
    hasHighChaos: targetCity !== null,
    targetCity,
    highestChaos,
    activeThreshold: threshold,
  };
}