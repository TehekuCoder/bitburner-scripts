import { FactionName, NS } from "@ns";

/** Liste aller bekannten Fraktionen in Bitburner */
const FACTIONS: string[] = [
  "Illuminati", "Daedalus", "The Covenant",
  "ECorp", "MegCorp", "Bachman & Associates", "Blade Industries", "NWO",
  "Clarke Incorporated", "OmniTek Incorporated", "Four Sigma", "KuaiGong International",
  "Fulcrum Secret Technologies", "BitRunners", "The Black Hand", "NiteSec",
  "Aevum", "Chongqing", "Ishima", "New Tokyo", "Sector-12", "Volhaven",
  "Speakers for the Dead", "The Dark Army", "The Syndicate", "Silhouette",
  "Tetrads", "Slum Snakes", "Netburners", "Tian Di Hui", "CyberSec",
  "Shadows of Anarchy"
];

interface AugDetails {
  factions: string[];
  price: number;
  rep: number;
  prereqs: string[];
}

export async function main(ns: NS): Promise<void> {
  if (!ns.singularity) {
    ns.tprint("❌ Dieses Skript benötigt die Singularity API (Source-File 4 / BN4).");
    return;
  }

  // Bereits gekaufte ODER installierte Augmentations ermitteln (purchased = true)
  const ownedAugs = new Set<string>(ns.singularity.getOwnedAugmentations(true));
  const missingAugs = new Map<string, AugDetails>();

  for (const faction of FACTIONS) {
    let factionAugs: string[] = [];
    try {
      factionAugs = ns.singularity.getAugmentationsFromFaction(faction as FactionName);
    } catch {
      continue; // Falls Fraktion im aktuellen BitNode nicht existiert
    }

    for (const aug of factionAugs) {
      if (aug === "NeuroFlux Governor") continue; // Wegen Unendlichkeit ausschließen
      if (ownedAugs.has(aug)) continue;          // Bereits vorhanden/gekauft

      if (!missingAugs.has(aug)) {
        missingAugs.set(aug, {
          factions: [faction],
          price: ns.singularity.getAugmentationPrice(aug),
          rep: ns.singularity.getAugmentationRepReq(aug),
          prereqs: ns.singularity.getAugmentationPrereq(aug)
        });
      } else {
        missingAugs.get(aug)!.factions.push(faction);
      }
    }
  }

  ns.tprint(`\n==================================================`);
  ns.tprint(`📊 FEHLENDE AUGMENTATIONS (${missingAugs.size} verbleibend)`);
  ns.tprint(`==================================================\n`);

  if (missingAugs.size === 0) {
    ns.tprint("🎉 Du besitzt bereits alle erhältlichen Augmentations!");
    return;
  }

  // Nach Preis aufsteigend sortieren
  const sorted = Array.from(missingAugs.entries()).sort((a, b) => a[1].price - b[1].price);

  for (const [aug, data] of sorted) {
    const priceStr = "$" + ns.format.number(data.price, 2);
    const repStr = ns.format.number(data.rep, 2);
    const factionsStr = data.factions.join(", ");
    const prereqStr = data.prereqs.length > 0 ? ` (Benötigt: ${data.prereqs.join(", ")})` : "";

    ns.tprint(`• ${aug}${prereqStr}`);
    ns.tprint(`  ├ Preis: ${priceStr} | Rep: ${repStr}`);
    ns.tprint(`  └ Fraktionen: ${factionsStr}\n`);
  }
}