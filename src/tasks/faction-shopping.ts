import { NS, FactionName } from "@ns";

interface AugShoppingItem {
  faction: FactionName;
  name: string;
  price: number;
  repReq: number;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🛍️ Faction-Shopping-Worker gestartert...");

  // --- SAFE ENVIRONMENT LAYER ---
  if (ns.singularity === undefined) {
    ns.print("🛑 [SHOP] Singularity API nicht verfügbar (SF4 fehlt).");
    return;
  }

  const sing = ns.singularity;
  const player = ns.getPlayer();
  const myFactions = player.factions;
  const NFG_NAME = "NeuroFlux Governor";

  // 1. ALLE EINZIGARTIGEN AUGMENTATIONS SCANNEN
  let shoppingList: AugShoppingItem[] = [];
  const ownedAugs = sing.getOwnedAugmentations(true); // Inklusive Warteschlange

  for (const faction of myFactions) {
    const factionRep = sing.getFactionRep(faction);
    const factionAugs = sing.getAugmentationsFromFaction(faction);

    for (const aug of factionAugs) {
      // NeuroFlux Governor wird komplett separat am Ende abgehandelt!
      if (aug === NFG_NAME) continue;
      if (ownedAugs.includes(aug)) continue;
      if (shoppingList.some((item) => item.name === aug)) continue;

      const repReq = sing.getAugmentationRepReq(aug);

      // Nur aufnehmen, wenn der Ruf ausreicht
      if (factionRep >= repReq) {
        const price = sing.getAugmentationPrice(aug);
        shoppingList.push({ faction, name: aug, price, repReq });
      }
    }
  }

  // 2. MATHEMATISCHE OPTIMIERUNG (Teuer -> Billig)
  shoppingList.sort((a, b) => b.price - a.price);

  // 3. EINKAUFSSCHLEIFE FÜR EINZIGARTIGE AUGMENTATIONS
  let boughtAnything = true;
  while (boughtAnything) {
    boughtAnything = false;

    for (let i = 0; i < shoppingList.length; i++) {
      const item = shoppingList[i];
      const currentPrice = sing.getAugmentationPrice(item.name);
      const currentMoney = ns.getPlayer().money;

      if (currentMoney >= currentPrice) {
        ns.print(`[SHOP] Versuche Kauf: ${item.name} von ${item.faction}`);
        const success = sing.purchaseAugmentation(item.faction, item.name);

        if (success) {
          ns.tprint(
            `✅ GEKAUFT: ${item.name} (${item.faction}) für $${ns.format.number(currentPrice)}`,
          );
          shoppingList.splice(i, 1);
          i--; // Index-Korrektur
          boughtAnything = true;
        }
      }
    }
  }

  // 4. LATE-GAME EXTRA-PHASE: NEUROFLUX GOVERNOR INFINITE DUMP
  ns.print("🔄 Phase 2: Optimiere verbleibendes Budget mit NeuroFlux Governor...");
  
  let boughtNFG = true;
  while (boughtNFG) {
    boughtNFG = false;
    
    // Finde in jedem Durchlauf die Fraktion, bei der wir aktuell NFG kaufen KÖNNTEN
    // (wichtig, da die Rep-Anforderung von NFG nach jedem Kauf steigt!)
    let bestNFGFaction: FactionName | null = null;
    let lowestRepReq = Infinity;

    for (const faction of myFactions) {
      const factionRep = sing.getFactionRep(faction);
      const repReq = sing.getAugmentationRepReq(NFG_NAME);
      
      // Haben wir genug Ruf bei dieser Fraktion für die NÄCHSTE Stufe?
      if (factionRep >= repReq) {
        // Wir nehmen die Fraktion, um sicherzustellen, dass die API greift
        bestNFGFaction = faction;
        break; 
      }
    }

    if (bestNFGFaction) {
      const nfgPrice = sing.getAugmentationPrice(NFG_NAME);
      const currentMoney = ns.getPlayer().money;

      if (currentMoney >= nfgPrice) {
        const success = sing.purchaseAugmentation(bestNFGFaction, NFG_NAME);
        if (success) {
          ns.tprint(`📈 NEUROFLUX UPGRADE: Stufe gekauft von ${bestNFGFaction} für $${ns.format.number(nfgPrice)}`);
          boughtNFG = true; // Weiter machen, solange Geld & Rep reichen
        }
      }
    }
  }

  ns.print("🏁 [SHOP] Shopping-Tour komplett abgeschlossen. Bereit für die Installation (Install Augmentations)!");
}