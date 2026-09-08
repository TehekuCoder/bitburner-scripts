import { BladeburnerActionName, CityName, NS } from "@ns";

export const CITIES: CityName[] = [
  "Aevum",
  "Chongqing",
  "Sector-12",
  "New Tokyo",
  "Ishima",
  "Volhaven",
];

export type BladeburnerCity = CityName;

export interface ChaosStatus {
  hasHighChaos: boolean;
  targetCity: CityName | null;
  highestChaos: number;
  activeThreshold: number;
}

/**
 * Berechnet eine dynamische Chaos-Schwelle basierend auf der Erfolgschance der Verträge.
 */
export function calculateDynamicThreshold(
  ns: NS,
  targetMinChance = 0.85,
): number {
  if (!ns.bladeburner || !ns.bladeburner.inBladeburner()) return 50;

  const contracts: BladeburnerActionName[] = [
    "Tracking",
    "Bounty Hunter",
    "Retirement",
  ];
  let lowestChance = 1.0;

  for (const contract of contracts) {
    const chance = ns.bladeburner.getActionEstimatedSuccessChance(
      "Contracts",
      contract,
    );
    if (chance[0] < lowestChance) {
      lowestChance = chance[0];
    }
  }

  if (lowestChance < targetMinChance) return 15;
  if (lowestChance < 0.95) return 40;
  return 75;
}

/**
 * Liefert den aktuellen Chaos-Status aller Städte für den Sleeve-Manager.
 */
export function getChaosStatus(ns: NS, targetMinChance = 0.85): ChaosStatus {
  if (!ns.bladeburner || !ns.bladeburner.inBladeburner()) {
    return {
      hasHighChaos: false,
      targetCity: null,
      highestChaos: 0,
      activeThreshold: 50,
    };
  }

  const threshold = calculateDynamicThreshold(ns, targetMinChance);
  let highestChaos = 0;
  let targetCity: CityName | null = null;

  for (const city of CITIES) {
    const chaos = ns.bladeburner.getCityChaos(city);
    if (chaos > highestChaos) {
      highestChaos = chaos;
    }
    if (
      chaos > threshold &&
      (!targetCity || chaos > ns.bladeburner.getCityChaos(targetCity))
    ) {
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

export function calculateCityScore(pop: number, chaos: number): number {
  if (pop <= 0) return 0;
  return pop / (chaos + 1);
}

/**
 * Überprüft alle Städte und wechselt automatisch die Stadt für den Hauptcharakter.
 */
export function manageCityAndChaos(ns: NS, maxChaosThreshold?: number): void {
  const currentCity = ns.bladeburner.getCity();
  const currentChaos = ns.bladeburner.getCityChaos(currentCity);
  const currentPop = ns.bladeburner.getCityEstimatedPopulation(currentCity);

  const threshold = maxChaosThreshold ?? calculateDynamicThreshold(ns);

  let bestCity: CityName = currentCity;
  let bestScore = calculateCityScore(currentPop, currentChaos);

  for (const city of CITIES) {
    if (city === currentCity) continue;

    const chaos = ns.bladeburner.getCityChaos(city);
    const pop = ns.bladeburner.getCityEstimatedPopulation(city);
    const score = calculateCityScore(pop, chaos);

    if (currentChaos > threshold || score > bestScore * 1.15) {
      bestScore = score;
      bestCity = city;
    }
  }

  if (bestCity !== currentCity) {
    ns.bladeburner.switchCity(bestCity);
    const newPop = ns.format.number(
      ns.bladeburner.getCityEstimatedPopulation(bestCity),
      1,
    );
    const newChaos = ns.bladeburner.getCityChaos(bestCity).toFixed(1);
    ns.print(
      `🌆 Stadt gewechselt: ${currentCity} ➔ ${bestCity} (Pop: ${newPop}, Chaos: ${newChaos})`,
    );
  }
}