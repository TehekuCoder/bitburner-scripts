import { NS, FactionName } from "@ns";
// Direkte Imports statt Barrel-Export
import { patchState } from "lib/state.js";
import { HACKING_FACTIONS } from "lib/constants.js";
// ➕ Import der Player-Helper
import { getPurchasedUninstalledAugs } from "lib/player.js";

export interface AugmentTarget {
  name: string;
  repReq: number;
  basePrice: number;
  prereqs: string[];
  factions: FactionName[];
  bestFaction: FactionName;
}

export async function main(ns: NS): Promise<void> {
  // 🟢 DUMMY-REFERENZ für den AST-Parser
  void ns.getHackingLevel;

  const sing = ns.singularity;
  const ownedAugs = sing.getOwnedAugmentations(true); // inkl. gekaufter/wartender
  const uninstalledCount = getPurchasedUninstalledAugs(ns).length; // ➕ Uninstalled Zähler
  
  const augMap = new Map<string, AugmentTarget>();

  // 1. Alle Fraktionen durchsuchen und Augments konsolidieren
  for (const factionObj of HACKING_FACTIONS) {
    const faction = factionObj.name as FactionName;
    let factionAugs: string[] = [];

    try {
      factionAugs = sing.getAugmentationsFromFaction(faction);
    } catch {
      continue; // Noch keinen Zugriff / Fehler
    }

    const currentRep = sing.getFactionRep(faction);

    for (const aug of factionAugs) {
      if (aug === "NeuroFlux Governor" || ownedAugs.includes(aug)) continue;

      const repReq = sing.getAugmentationRepReq(aug);
      const basePrice = sing.getAugmentationPrice(aug);
      const prereqs = sing.getAugmentationPrereq(aug);

      if (!augMap.has(aug)) {
        augMap.set(aug, {
          name: aug,
          repReq,
          basePrice,
          prereqs,
          factions: [faction],
          bestFaction: faction,
        });
      } else {
        const existing = augMap.get(aug)!;
        if (!existing.factions.includes(faction)) {
          existing.factions.push(faction);
        }
        // Wähle die Fraktion, bei der wir bereits mehr Ruf haben!
        const bestRep = sing.getFactionRep(existing.bestFaction);
        if (currentRep > bestRep) {
          existing.bestFaction = faction;
        }
      }
    }
  }

  // 2. In eine Liste umwandeln und nach Rep-Anforderung sortieren (Aufsteigend)
  const augRoadmap = Array.from(augMap.values()).sort((a, b) => a.repReq - b.repReq);

  // 3. Im State speichern & informativen Log ausgeben
  patchState(ns, { augRoadmap } as any);
  
  ns.tprint(
    `INFO: Augment-Analyse abgeschlossen. ${augRoadmap.length} ausstehende Augments in der Roadmap. (${uninstalledCount} gekaufte Augments bereit zum Installieren)`
  );
}