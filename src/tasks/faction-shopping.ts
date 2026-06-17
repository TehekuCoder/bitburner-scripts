import { NS, FactionName } from "@ns";

interface AugShoppingItem {
  faction: FactionName;
  name: string;
  price: number;
  repReq: number;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  if (ns.singularity === undefined) {
    ns.print("🛑 [SHOP] Singularity API nicht verfügbar.");
    return;
  }

  const sing = ns.singularity;
  const player = ns.getPlayer();
  const myFactions = player.factions;
  const NFG_NAME = "NeuroFlux Governor";

  // --- GANG-DETEKTION ---
  // Wir ermitteln, ob wir eine Gang haben, um diese Fraktion vom Singularity-Kauf auszuschließen
  let gangFaction = "";
  try {
    if (ns.gang && ns.gang.inGang()) {
      gangFaction = ns.gang.getGangInformation().faction;
    }
  } catch {
    // Falls das Quellfile/API-Recht für Gangs im aktuellen Node noch fehlt
  }

  let report: string[] = [];
  const logReport = (msg: string) => {
    ns.print(msg);
    report.push(msg);
  };

  logReport("==================================================");
  logReport("🛍️ SHOPPING REPORT - " + new Date().toLocaleTimeString());
  logReport("==================================================\n");

  // 1. ALLE EINZIGARTIGEN AUGMENTATIONS SCANNEN
  let shoppingList: AugShoppingItem[] = [];
  const ownedAugs = sing.getOwnedAugmentations(true);

  for (const faction of myFactions) {
    // FIX: Überspringe die eigene Gang, da deren Upgrades über ns.gang gekauft werden müssen
    if (faction === gangFaction) continue;

    const factionRep = sing.getFactionRep(faction);
    const factionAugs = sing.getAugmentationsFromFaction(faction);

    for (const aug of factionAugs) {
      if (aug === NFG_NAME) continue;
      if (ownedAugs.includes(aug)) continue;
      if (shoppingList.some((item) => item.name === aug)) continue;

      const repReq = sing.getAugmentationRepReq(aug);

      if (factionRep >= repReq) {
        const price = sing.getAugmentationPrice(aug);
        shoppingList.push({ faction, name: aug, price, repReq });
      }
    }
  }

  logReport(
    "📋 Scanner-Ergebnis: " +
      shoppingList.length +
      " einzigartige Augmentations qualifiziert.",
  );
  for (const item of shoppingList) {
    logReport(
      "  -> " +
        item.name +
        " (" +
        item.faction +
        ") - $" +
        ns.format.number(item.price),
    );
  }
  logReport("");

  // 2. MATHEMATISCHE OPTIMIERUNG (Teuerste zuerst wegen des 1.9x Multiplikators)
  shoppingList.sort((a, b) => b.price - a.price);

  // 3. EINKAUFSSCHLEIFE
  let boughtAnything = true;
  while (boughtAnything) {
    boughtAnything = false;
    const currentOwnedAndQueued = sing.getOwnedAugmentations(true);

    // Nutzen einer klassischen Rückwärtsschleife für stabileres In-Place Splicing
    for (let i = shoppingList.length - 1; i >= 0; i--) {
      const item = shoppingList[i];
      const currentPrice = sing.getAugmentationPrice(item.name);
      const currentMoney = ns.getPlayer().money;

      const prereqs = sing.getAugmentationPrereq(item.name);
      const missingPrereqs = prereqs.filter(
        (p) => !currentOwnedAndQueued.includes(p),
      );

      if (missingPrereqs.length > 0) {
        const prereqOnList = missingPrereqs.every((p) =>
          shoppingList.some((s) => s.name === p),
        );
        if (!prereqOnList) {
          logReport(
            "⚠️ Skip " +
              item.name +
              ": Voraussetzung fehlt komplett im Besitz (" +
              missingPrereqs.join(", ") +
              ")",
          );
        }
        continue;
      }

      if (currentMoney < currentPrice) {
        continue; // Geld reicht (noch) nicht, eventuell nach dem nächsten Zyklus
      }

      logReport("[SHOP] Versuche Kauf: " + item.name + " von " + item.faction);
      const success = sing.purchaseAugmentation(item.faction, item.name);

      if (success) {
        logReport(
          "✅ ERFOLGREICH GEKAUFT: " + item.name + " (" + item.faction + ")",
        );
        shoppingList.splice(i, 1);
        boughtAnything = true;
      } else {
        logReport("❌ Interner API-Fehler beim Kauf von " + item.name);
      }
    }
  }

  // 4. LATE-GAME EXTRA-PHASE: NEUROFLUX GOVERNOR DUMP
  logReport("\n🔄 Phase 2: NeuroFlux Governor Dump...");
  let boughtNFG = true;
  let nfgCount = 0;

  while (boughtNFG) {
    boughtNFG = false;
    let bestNFGFaction: FactionName | null = null;

    for (const faction of myFactions) {
      if (faction === gangFaction) continue; // Auch hier die Gang ausschließen

      const factionRep = sing.getFactionRep(faction);
      const repReq = sing.getAugmentationRepReq(NFG_NAME);

      if (factionRep >= repReq) {
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
          nfgCount++;
          boughtNFG = true;
        }
      }
    }
  }

  if (nfgCount > 0) {
    logReport(
      "📈 NEUROFLUX UPGRADES: Insgesamt " + nfgCount + " Stufen investiert.",
    );
  } else {
    logReport("ℹ️ Kein NeuroFlux Governor gekauft.");
  }

  logReport("\n🏁 Report Ende. Bereit für die Installation.");
  await ns.write("/temp/shop-report.txt", report.join("\n"), "w");
}
