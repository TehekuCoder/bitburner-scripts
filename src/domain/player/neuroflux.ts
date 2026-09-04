import { NS, FactionName } from "@ns";

export interface NeuroFluxTarget {
  faction: FactionName;
  price: number;
  repReq: number;
}

/**
 * Findet die Fraktion mit dem höchsten Ansehen, bei der NeuroFlux gekauft werden kann.
 */
export function getBestNeuroFluxTarget(ns: NS): NeuroFluxTarget | null {
  const sing = ns.singularity;
  const playerFactions = ns.getPlayer().factions;
  
  let bestTarget: NeuroFluxTarget | null = null;
  let maxRep = -1;

  for (const faction of playerFactions) {
    const rep = sing.getFactionRep(faction);
    const augs = sing.getAugmentationsFromFaction(faction);

    if (augs.includes("NeuroFlux Governor")) {
      const price = sing.getAugmentationPrice("NeuroFlux Governor");
      const repReq = sing.getAugmentationRepReq("NeuroFlux Governor");

      if (rep >= repReq && rep > maxRep) {
        maxRep = rep;
        bestTarget = { faction, price, repReq };
      }
    }
  }

  return bestTarget;
}

/**
 * Prüft, ob ein Reset/Soft-Reset sinnvoll ist.
 */
export function shouldPerformReset(ns: NS, minUninstalledAugs = 5): boolean {
  const sing = ns.singularity;
  const uninstalled = sing.getOwnedAugmentations(true).length - sing.getOwnedAugmentations(false).length;
  
  // Wenn genug Augmentations gekauft wurden (oder Red Pill dabei ist)
  const hasRedPillUninstalled = sing.getOwnedAugmentations(true).includes("The Red Pill") &&
                                !sing.getOwnedAugmentations(false).includes("The Red Pill");

  return uninstalled >= minUninstalledAugs || hasRedPillUninstalled;
}