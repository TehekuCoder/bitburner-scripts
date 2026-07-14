import { NS, FactionName } from "@ns";
import { patchState } from "/core/state-manager.js";
import { 
  HACKING_FACTIONS, 
} from "../lib/constants.js";

export async function main(ns: NS): Promise<void> {
  // Holt installierte + gekaufte (aber noch nicht installierte) Augmentations
  const ownedAugs = ns.singularity.getOwnedAugmentations(true);
  
  // Saubere TypeScript-Typisierung für das Ziel-Objekt
const factionTargets = {} as Record<FactionName, number>;

  for (const faction of HACKING_FACTIONS) {
    let highestRepRequired = 0;
    try {
      const augs = ns.singularity.getAugmentationsFromFaction(faction.name);
      
      for (const aug of augs) {
        // NeuroFlux Governor ignorieren, da er unendlich oft gekauft werden kann
        if (!ownedAugs.includes(aug) && aug !== "NeuroFlux Governor") {
          const req = ns.singularity.getAugmentationRepReq(aug);
          if (req > highestRepRequired) {
            highestRepRequired = req;
          }
        }
      }
      // FEHLERBEHEBUNG: In factionTargets schreiben, nicht in HACKING_FACTIONS
      factionTargets[faction.name] = highestRepRequired;
    } catch {
      // Falls wir noch keinen Zugriff auf die Faction haben oder die API fehlschlägt
      factionTargets[faction.name] = 0;
    }
  }

  // Schreibe die berechneten Ziele in den globalen State
  patchState(ns, { factionTargets });
  
  ns.tprint("INFO: Faction-Reputation-Analyse erfolgreich abgeschlossen.");
}