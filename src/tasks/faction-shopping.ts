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

  // --- REPORT LOGGER SETUP ---
  let report: string[] = [];
  const logReport = (msg: string) => {
    ns.print(msg); // Für das normale Log
    report.push(msg); // Für die Textdatei
  };

  logReport(`==================================================`);
  logReport(`🛍️ SHOPPING REPORT - ${new Date().toLocaleTimeString()}`);
  logReport(`==================================================\n`);

  // 1. ALLE EINZIGARTIGEN AUGMENTATIONS SCANNEN
  let shoppingList: AugShoppingItem[] = [];
  const ownedAugs = sing.getOwnedAugmentations(true);

  for (const faction of myFactions) {
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
    `📋 Scanner-Ergebnis: ${shoppingList.length} einzigartige Augmentations qualifiziert.`,
  );
  for (const item of shoppingList) {
    logReport(
      `  -> ${item.name} (${item.faction}) - $${ns.format.number(item.price)}`,
    );
  }
  logReport("");

  // 2. MATHEMATISCHE OPTIMIERUNG
  shoppingList.sort((a, b) => b.price - a.price);

  // 3. EINKAUFSSCHLEIFE
  let boughtAnything = true;
  while (boughtAnything) {
    boughtAnything = false;
    const currentOwnedAndQueued = sing.getOwnedAugmentations(true);

    for (let i = 0; i < shoppingList.length; i++) {
      const item = shoppingList[i];
      const currentPrice = sing.getAugmentationPrice(item.name);
      const currentMoney = ns.getPlayer().money;

      // Abhängigkeiten prüfen
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
            `⚠️ Skip ${item.name}: Voraussetzung fehlt komplett im Besitz (${missingPrereqs.join(", ")})`,
          );
        }
        continue;
      }

      // Finanz-Check
      if (currentMoney < currentPrice) {
        logReport(
          `💸 Zu wenig Geld für ${item.name}: Benötigt $${ns.format.number(currentPrice)}, hast $${ns.format.number(currentMoney)}`,
        );
        continue;
      }

      logReport(`[SHOP] Versuche Kauf: ${item.name} von ${item.faction}`);
      const success = sing.purchaseAugmentation(item.faction, item.name);

      if (success) {
        logReport(`✅ ERFOLGREICH GEKAUFT: ${item.name} (${item.faction})`);
        shoppingList.splice(i, 1);
        i--;
        boughtAnything = true;
      } else {
        logReport(`❌ Interner API-Fehler beim Kauf von ${item.name}.`);
      }
    }
  }

  // 4. LATE-GAME EXTRA-PHASE: NEUROFLUX GOVERNOR
  logReport("\n🔄 Phase 2: NeuroFlux Governor Dump...");
  let boughtNFG = true;
  let nfgCount = 0;

  while (boughtNFG) {
    boughtNFG = false;
    let bestNFGFaction: FactionName | null = null;

    for (const faction of myFactions) {
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
      `📈 NEUROFLUX UPGRADES: Insgesamt ${nfgCount} Stufen investiert.`,
    );
  } else {
    logReport(
      `ℹ️ Kein NeuroFlux Governor gekauft (Geld oder Ruf reichte nicht für die nächste Stufe).`,
    );
  }

  logReport(`\n🏁 Report Ende. Bereit für die Installation.`);

  // --- REPORT SPEICHERN ---
  // ns.write kostet 0 GB RAM und überschreibt ("w") die Datei jedes Mal neu
  await ns.write("/temp/shop-report.txt", report.join("\n"), "w");
}
