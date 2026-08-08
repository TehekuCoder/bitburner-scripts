import { NS, FactionName } from "@ns";
import { patchAugmentState } from "lib/state.js";
import { FACTION_ROADMAP, CITY_FACTIONS, MEGACORPS } from "lib/constants.js";
import {
  getPurchasedUninstalledAugs,
  isGangOfferingAllAugs,
} from "lib/player.js";

export interface AugmentTarget {
  name: string;
  repReq: number;
  basePrice: number;
  prereqs: string[];
  factions: FactionName[];
  bestFaction: FactionName;
}

// 🌐 Vollständiges Register aller Bitburner-Fraktionen
const ALL_KNOWN_FACTIONS: FactionName[] = [
  "CyberSec", "Tian Di Hui", "Netburners",
  "NiteSec", "The Black Hand", "BitRunners",
  "Daedalus", "Illuminati", "The Covenant",
  "ECorp", "MegaCorp", "Bachman & Associates", "Blade Industries",
  "NXP Logistics", "Volhaven Corp", "Clarke Incorporated",
  "Omnia Cyberspace", "Four Sigma", "KuaiGong International",
  "Fulcrum Secret Technologies",
  "Slum Snakes", "Tetrads", "Syndicate", "Dark Army", "Speakers for the Dead",
  ...CITY_FACTIONS,
] as FactionName[];

export async function main(ns: NS): Promise<void> {
  void ns.getHackingLevel;

  const sing = ns.singularity;
  const ownedAugs = sing.getOwnedAugmentations(true);
  const uninstalledCount = getPurchasedUninstalledAugs(ns).length;

  const augMap = new Map<string, AugmentTarget>();

  // 1. Alle bekannten Fraktionen erfassen
  const factionsToScan = new Set<FactionName>([
    ...FACTION_ROADMAP.map((f) => f.name as FactionName),
    ...ALL_KNOWN_FACTIONS,
  ]);

  let gangFaction: FactionName | null = null;
  try {
    if (ns.gang && ns.gang.inGang()) {
      gangFaction = ns.gang.getGangInformation().faction as FactionName;
      factionsToScan.add(gangFaction);
    }
  } catch {}

  const isBN2Gang = isGangOfferingAllAugs(ns);

  if (isBN2Gang) {
    ns.print(
      "⚡ [ANALYSIS] BitNode 2 Gang-Modus erkannt! Gang liefert alle Augmentations.",
    );
  }

  for (const faction of factionsToScan) {
    let factionAugs: string[] = [];

    try {
      factionAugs = sing.getAugmentationsFromFaction(faction);
    } catch {
      continue;
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
        
        // Bei der Auswahl von bestFaction ignorieren wir die Gang außerhalb von BN2 für den Spieler-Rep-Grind
        const isGang = faction === gangFaction;
        if (!isGang || isBN2Gang) {
          const bestRep = sing.getFactionRep(existing.bestFaction);
          if (currentRep > bestRep || existing.bestFaction === gangFaction) {
            existing.bestFaction = faction;
          }
        }
      }
    }
  }

  const augRoadmap = Array.from(augMap.values()).sort(
    (a, b) => a.repReq - b.repReq,
  );

  patchAugmentState(ns, { 
    augRoadMap: augRoadmap,
    isBN2GangMode: isBN2Gang 
  });

  ns.print(
    `INFO: Augment-Analyse abgeschlossen. ${augRoadmap.length} ausstehende Augments in der Roadmap. (${uninstalledCount} gekaufte Augments bereit zum Installieren)`,
  );
}