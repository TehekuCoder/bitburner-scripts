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

  // 1️⃣ Gang-Status und Gang-Augmentations ermitteln
  let gangFaction: string | null = null;
  const gangAugs = new Set<string>();

  if (ns.gang && ns.gang.inGang()) {
    gangFaction = ns.gang.getGangInformation().faction;
    try {
      const augs = ns.singularity.getAugmentationsFromFaction(gangFaction as FactionName);
      augs.forEach((aug) => gangAugs.add(aug));
    } catch {
      ns.tprint(`⚠️ Konnte Augmentations der Gang-Fraktion (${gangFaction}) nicht abrufen.`);
    }
  } else {
    ns.tprint("ℹ️ Du bist aktuell in keiner Gang. Alle fehlenden Augmentations werden angezeigt.");
  }

  // 2️⃣ Bereits gekaufte / installierte Augmentations ermitteln
  const ownedAugs = new Set<string>(ns.singularity.getOwnedAugmentations(true));
  const missingNonGangAugs = new Map<string, AugDetails>();

  // 3️⃣ Alle Fraktionen durchsuchen
  for (const faction of FACTIONS) {
    let factionAugs: string[] = [];
    try {
      factionAugs = ns.singularity.getAugmentationsFromFaction(faction as FactionName);
    } catch {
      continue; // Falls Fraktion im BitNode nicht existiert
    }

    for (const aug of factionAugs) {
      if (aug === "NeuroFlux Governor") continue; // Unendlich-Augmentation
      if (ownedAugs.has(aug)) continue;          // Bereits im Besitz/Gekauft
      if (gangAugs.has(aug)) continue;           // WIRD VON GANG ANGEBOTEN ➔ UMBEGEHEN!

      if (!missingNonGangAugs.has(aug)) {
        missingNonGangAugs.set(aug, {
          factions: [faction],
          price: ns.singularity.getAugmentationPrice(aug),
          rep: ns.singularity.getAugmentationRepReq(aug),
          prereqs: ns.singularity.getAugmentationPrereq(aug)
        });
      } else {
        missingNonGangAugs.get(aug)!.factions.push(faction);
      }
    }
  }

  // 4️⃣ Ergebnis-Ausgabe
  ns.tprint(`\n==================================================`);
  if (gangFaction) {
    ns.tprint(`🥊 GANG: ${gangFaction} (${gangAugs.size} Augmentations verfügbar)`);
  }
  ns.tprint(`📊 FEHLENDE NICHT-GANG AUGMENTATIONS (${missingNonGangAugs.size} verbleibend)`);
  ns.tprint(`==================================================\n`);

  if (missingNonGangAugs.size === 0) {
    ns.tprint("🎉 Deine Gang (oder dein Inventar) deckt bereits alle erhältlichen Augmentations ab!");
    return;
  }

  // Aufsteigend nach Preis sortieren
  const sorted = Array.from(missingNonGangAugs.entries()).sort((a, b) => a[1].price - b[1].price);

  for (const [aug, data] of sorted) {
    const priceStr = "$" + ns.format.number(data.price, 2);
    const repStr = ns.format.number(data.rep, 2);
    const factionsStr = data.factions.join(", ");
    const prereqStr = data.prereqs.length > 0 ? ` (Benötigt: ${data.prereqs.join(", ")})` : "";

    ns.tprint(`• ${aug}${prereqStr}`);
    ns.tprint(`   ├ Preis: ${priceStr} | Ruf: ${repStr}`);
    ns.tprint(`   └ Erhältlich bei: ${factionsStr}\n`);
  }
}