import { NS, FactionName, BitNodeMultipliers } from "@ns";
import { DEFAULT_MULTIPLIERS, AUG_PRICE_MULT, MAX_WAIT_TIME_SECONDS } from "/lib/constants";
import { patchState } from "/lib/state";
import { AugShoppingItem } from "/lib/types";
// ➕ Import der Player-Helper
import { getPurchasedUninstalledAugs, hasPurchasedAugsThisRun } from "/lib/player";

function getBitNodeMultipliers(ns: NS): BitNodeMultipliers {
  const multsFilePath = "/bn-multipliers.txt";
  if (ns.fileExists(multsFilePath, "home")) {
    try {
      return JSON.parse(ns.read(multsFilePath)) as BitNodeMultipliers;
    } catch {}
  }
  return DEFAULT_MULTIPLIERS as unknown as BitNodeMultipliers;
}

function calculateMinBatchSize(augMoneyMult: number): number {
  const BASE_BATCH_SIZE = 10; // Community-Standard für Augmentation-Installs
  if (augMoneyMult <= 1.0) return BASE_BATCH_SIZE;

  // Bei schweren BitNodes (hohe Kosten) die Hürde moderat senken (min. 3)
  return Math.max(3, Math.round(BASE_BATCH_SIZE / Math.sqrt(augMoneyMult)));
}

function getIncomePerSecond(ns: NS): number {
  let income = 0;
  try {
    const scriptInc = ns.getTotalScriptIncome();
    income += Array.isArray(scriptInc) ? scriptInc[0] : scriptInc;
  } catch {}

  try {
    if (ns.gang && ns.gang.inGang()) {
      income += ns.gang.getGangInformation().moneyGainRate * 5;
    }
  } catch {}

  return income;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "∞";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `${mins}m ${secs}s`;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  if (ns.singularity === undefined) {
    ns.print("🛑 [SHOP] Singularity API nicht verfügbar.");
    patchState(ns, { financeProgress: "Shop: Keine Singularity API" });
    return;
  }

  const sing = ns.singularity;
  const player = ns.getPlayer();
  const myFactions = player.factions;
  const NFG_NAME = "NeuroFlux Governor";

  // BitNode Multiplikatoren laden & dynamischen Batch berechnen
  const bnMults = getBitNodeMultipliers(ns);
  const minBatchSize = calculateMinBatchSize(
    bnMults.AugmentationMoneyCost ?? 1.0,
  );

  // ➕ Abfrage der bereits gekauften, aber noch nicht installierten Augmentations
  const uninstalledAugs = getPurchasedUninstalledAugs(ns);
  const pendingCount = uninstalledAugs.length;

  let gangFaction = "";
  try {
    if (ns.gang && ns.gang.inGang()) {
      gangFaction = ns.gang.getGangInformation().faction;
    }
  } catch {}

  let report: string[] = [];
  const logReport = (msg: string) => {
    ns.print(msg);
    report.push(msg);
  };

  logReport("==================================================");
  logReport("🛍️ FACTION SHOPPING REPORT - " + new Date().toLocaleTimeString());
  logReport(
    `⚙️ AugCostMult: ${bnMults.AugmentationMoneyCost} | Ziel-Batch: ${minBatchSize} | Bereit für Install: ${pendingCount}`,
  );
  logReport("==================================================\n");

  let shoppingList: AugShoppingItem[] = [];
  const ownedAugs = sing.getOwnedAugmentations(true);

  // 1. SCANNER: Qualifizierte Augmentations erfassen
  for (const faction of myFactions) {
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
    `📋 Scanner-Ergebnis: ${shoppingList.length} einzigartige Augmentations qualifiziert.`,
  );

  if (shoppingList.length === 0) {
    const statusMsg = pendingCount > 0 
      ? `Shop: Bereit für Reset (${pendingCount} Augs ausstehend)` 
      : "Shop: Inaktiv (Keine Augs)";
    logReport(`ℹ️ Keine weiteren kaufbaren Augmentations vorhanden. (${statusMsg})`);
    patchState(ns, { financeProgress: statusMsg });
    await ns.write("/temp/shop-report.txt", report.join("\n"), "w");
    return;
  }

  // Abhängigkeiten prüfen (Prereqs)
  const validCandidates = shoppingList.filter((item) => {
    const prereqs = sing.getAugmentationPrereq(item.name);
    return prereqs.every(
      (p) => ownedAugs.includes(p) || shoppingList.some((s) => s.name === p),
    );
  });

  // Sortierung: Teuerste zuerst (Top-Down)
  validCandidates.sort((a, b) => b.price - a.price);

  // 2. SIMULATION: Wie viele können wir JETZT mit 1.9x Preisskalierung kaufen?
  let tempMoney = player.money;
  const affordableBatch: AugShoppingItem[] = [];
  let simulatedMultiplier = 1.0;

  for (const item of validCandidates) {
    const scaledPrice = item.price * simulatedMultiplier;
    if (tempMoney >= scaledPrice) {
      tempMoney -= scaledPrice;
      affordableBatch.push(item);
      simulatedMultiplier *= AUG_PRICE_MULT;
    }
  }

  const currentIncome = getIncomePerSecond(ns);
  const canAffordAll = affordableBatch.length === validCandidates.length;

  // ➕ KORREKTUR: Bereits gekaufte Augmentations zählen zum Batch-Ziel dazu!
  const totalBatchSize = pendingCount + affordableBatch.length;
  const meetsBatchThreshold = totalBatchSize >= minBatchSize;

  logReport(
    `💡 Bezahlbar im Batch: ${affordableBatch.length} neue (+ ${pendingCount} bereits gekauft = ${totalBatchSize}/${minBatchSize} Ziel)`,
  );

  // 3. KAUF ODER SPAREN
  let boughtCount = 0;

  if (meetsBatchThreshold || canAffordAll) {
    logReport(
      `🚀 BATCH-KAUF FREIGEGEBEN (${affordableBatch.length} neue Augs bereit)`,
    );

    for (const item of affordableBatch) {
      const actualPrice = sing.getAugmentationPrice(item.name);
      if (player.money >= actualPrice) {
        const success = sing.purchaseAugmentation(item.faction, item.name);
        if (success) {
          logReport(
            `✅ GEKAUFT: ${item.name} ($${ns.format.number(actualPrice)})`,
          );
          boughtCount++;
        }
      }
    }
  } else {
    // Noch nicht genug für den Batch -> Sparzeit ermitteln
    const nextTarget = validCandidates.find(
      (item) => !affordableBatch.some((a) => a.name === item.name),
    );

    if (nextTarget) {
      const neededMoney = nextTarget.price - player.money;
      const waitSeconds =
        currentIncome > 0 ? neededMoney / currentIncome : Infinity;

      if (waitSeconds <= MAX_WAIT_TIME_SECONDS) {
        const waitText = `Spare auf ${nextTarget.name} (~${formatTime(waitSeconds)}) [Batch: ${totalBatchSize}/${minBatchSize}]`;
        logReport(`⏳ SPAR-MODUS: ${waitText}`);
        patchState(ns, { financeProgress: `Shop: ${waitText}` });
        await ns.write("/temp/shop-report.txt", report.join("\n"), "w");
        return;
      } else {
        logReport(
          `ℹ️ Warten auf ${nextTarget.name} dauert zu lange (~${formatTime(waitSeconds)}). Batch-Ziel (${minBatchSize}) noch nicht erreicht.`,
        );
      }
    }
  }

  // 4. LATE-GAME: NEUROFLUX DUMP
  if (canAffordAll || boughtCount > 0 || hasPurchasedAugsThisRun(ns)) {
    logReport("\n🔄 Phase 2: NeuroFlux Governor Dump...");
    let boughtNFG = true;
    let nfgCount = 0;

    while (boughtNFG) {
      boughtNFG = false;
      let bestNFGFaction: FactionName | null = null;
      let highestRep = -1;
      const repReq = sing.getAugmentationRepReq(NFG_NAME);

      for (const faction of myFactions) {
        if (faction === gangFaction) continue;

        const factionRep = sing.getFactionRep(faction);
        if (factionRep >= repReq && factionRep > highestRep) {
          highestRep = factionRep;
          bestNFGFaction = faction;
        }
      }

      if (bestNFGFaction) {
        const nfgPrice = sing.getAugmentationPrice(NFG_NAME);
        if (ns.getPlayer().money >= nfgPrice) {
          if (sing.purchaseAugmentation(bestNFGFaction, NFG_NAME)) {
            nfgCount++;
            boughtNFG = true;
          }
        }
      }
    }

    if (nfgCount > 0) {
      logReport(`📈 NEUROFLUX UPGRADES: ${nfgCount} Stufen gekauft.`);
      boughtCount += nfgCount;
    }
  }

  // ➕ Aktualisierte Gesamtanzahl an uninstallierten Augs ermitteln
  const finalUninstalledCount = getPurchasedUninstalledAugs(ns).length;

  // State Patch
  const finalStatus =
    boughtCount > 0
      ? `Shop: ${boughtCount} Augs neu gekauft (${finalUninstalledCount} bereit für Reset)`
      : `Shop: Warten auf Batch (${finalUninstalledCount}/${minBatchSize})`;

  patchState(ns, { financeProgress: finalStatus });

  logReport("\n🏁 Report Ende.");
  await ns.write("/temp/shop-report.txt", report.join("\n"), "w");
}