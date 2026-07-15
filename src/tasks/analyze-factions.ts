import { NS, FactionName } from "@ns";
import { patchState } from "../core/state-manager.js"; // 🟢 Relativ importiert
import { HACKING_FACTIONS } from "../lib/constants.js";

export async function main(ns: NS): Promise<void> {
  const ownedAugs = ns.singularity.getOwnedAugmentations(true);
  const factionTargets = {} as Record<FactionName, number>;

  for (const faction of HACKING_FACTIONS) {
    let highestRepRequired = 0;
    try {
      const augs = ns.singularity.getAugmentationsFromFaction(faction.name);
      
      for (const aug of augs) {
        if (!ownedAugs.includes(aug) && aug !== "NeuroFlux Governor") {
          const req = ns.singularity.getAugmentationRepReq(aug);
          if (req > highestRepRequired) {
            highestRepRequired = req;
          }
        }
      }
      factionTargets[faction.name] = highestRepRequired;
    } catch {
      factionTargets[faction.name] = 0;
    }
  }

  patchState(ns, { factionTargets });
  ns.tprint("INFO: Faction-Reputation-Analyse erfolgreich abgeschlossen.");
}