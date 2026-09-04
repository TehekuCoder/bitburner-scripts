import { NS, FactionName } from "@ns";
import { FACTION_ROADMAP, CITY_FACTIONS } from "/shared/constants/factions.js";
import {
  getPurchasedUninstalledAugs,
  isGangOfferingAllAugs,
} from "/domain/strategy/player.js";
import { patchAugmentState } from "/infrastructure/state/state";

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
  "CyberSec",
  "Tian Di Hui",
  "Netburners",
  "NiteSec",
  "The Black Hand",
  "BitRunners",
  "Daedalus",
  "Illuminati",
  "The Covenant",
  "Bladeburners",
  "ECorp",
  "MegaCorp",
  "Bachman & Associates",
  "Blade Industries",
  "NWO",
  "Clarke Incorporated",
  "OmniTek Incorporated",
  "Four Sigma",
  "KuaiGong International",
  "Fulcrum Secret Technologies",
  "Slum Snakes",
  "Tetrads",
  "Syndicate",
  "The Dark Army",
  "Speakers for the Dead",
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
    let currentRep = 0;

    try {
      factionAugs = sing.getAugmentationsFromFaction(faction);
      currentRep = sing.getFactionRep(faction);
    } catch {
      // Fraktion noch nicht verfügbar oder ungültig
      continue;
    }

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

        const player = ns.getPlayer();
        const isCurrentJoined = player.factions.includes(faction);
        const isBestJoined = player.factions.includes(existing.bestFaction);

        // 1. Bevorzuge immer Fraktionen, bei denen der Spieler bereits Mitglied ist
        if (isCurrentJoined && !isBestJoined) {
          existing.bestFaction = faction;
        } else if (isCurrentJoined === isBestJoined) {
          // 2. Bei gleichem Mitglieds-Status gewinnt die Fraktion mit höherem Ruf
          const bestRep = sing.getFactionRep(existing.bestFaction);
          if (currentRep > bestRep) {
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
    isBN2GangMode: isBN2Gang,
  });

  ns.print(
    `INFO: Augment-Analyse abgeschlossen. ${augRoadmap.length} ausstehende Augments in der Roadmap. (${uninstalledCount} gekaufte Augments bereit zum Installieren)`,
  );
}
