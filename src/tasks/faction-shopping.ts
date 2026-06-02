import { NS, FactionName } from "@ns";

interface AugShoppingItem {
  faction: FactionName;
  name: string;
  price: number;
  repReq: number;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.print("🛍️ Faction-Shopping-Worker gestartet. Bereite Großeinkauf vor...");

  const sing = ns.singularity;
  const player = ns.getPlayer();
  const myFactions = player.factions;

  // 1. ALLE VERFÜGBAREN AUGMENTATIONS SCANNEN
  let shoppingList: AugShoppingItem[] = [];
  const ownedAugs = sing.getOwnedAugmentations(true); // true = inklusive gekaufte, aber noch nicht installierte

  for (const faction of myFactions) {
    const factionRep = sing.getFactionRep(faction);
    const factionAugs = sing.getAugmentationsFromFaction(faction);

    for (const aug of factionAugs) {
      // Wenn wir sie schon haben oder sie bereits auf der Einkaufsliste steht, weitergehen
      if (ownedAugs.includes(aug)) continue;
      if (shoppingList.some((item) => item.name === aug)) continue;

      const repReq = sing.getAugmentationRepReq(aug);

      // Wir nehmen sie nur auf, wenn unser Ruf bei der Fraktion ausreicht
      if (factionRep >= repReq) {
        const price = sing.getAugmentationPrice(aug);
        shoppingList.push({ faction, name: aug, price, repReq });
      }
    }
  }

  // 2. MATHEMATISCHE OPTIMIERUNG (Teuer -> Billig)
  // Da jede gekaufte Augmentation den Preis aller anderen um das ~1.9-fache erhöht,
  // MÜSSEN wir die teuersten zuerst kaufen, um das meiste aus unserem Geld herauszuholen!
  shoppingList.sort((a, b) => b.price - a.price);

  if (shoppingList.length === 0) {
    ns.print("🛑 Keine kaufbaren Augmentations gefunden.");
    return;
  }

  // 3. DIE BRUTE-FORCE-EINKAUFSSCHLEIFE
  let boughtAnything = true;

  while (boughtAnything) {
    boughtAnything = false;

    for (let i = 0; i < shoppingList.length; i++) {
      const item = shoppingList[i];

      // Preis live abfragen, da er nach jedem erfolgreichen Kauf eskaliert!
      const currentPrice = sing.getAugmentationPrice(item.name);
      const currentMoney = ns.getPlayer().money;

      if (currentMoney >= currentPrice) {
        ns.print(`[SHOP] Versuche Kauf: ${item.name} von ${item.faction}`);
        const success = sing.purchaseAugmentation(item.faction, item.name);

        if (success) {
          ns.tprint(
            `✅ ERFOLGREICH GEKAUFT: ${item.name} von ${item.faction} für $${ns.format.number(currentPrice)}`,
          );
          shoppingList.splice(i, 1); // Aus der Einkaufsliste entfernen
          i--; // Index korrigieren, da die Liste geschrumpft ist
          boughtAnything = true; // Loop am Leben erhalten
        }
      }
    }
  }

  ns.print(
    "🏁 Shopping-Tour beendet. Es kann nichts mehr sinnvoll gekauft werden.",
  );
}
