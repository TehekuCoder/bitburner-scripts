import { NS, FactionName } from "@ns";
import { AugShoppingItem } from "/core/types";

// ============================================================================
// KONFIGURATION
// ============================================================================
// Maximal hinnehmbare Wartezeit in Sekunden (z. B. 600s = 10 Minuten).
// Wenn das nächste teurere Augment in unter dieser Zeit erreichbar ist,
// pausiert das Skript alle Käufe und spart das Geld an.
const MAX_WAIT_TIME_SECONDS = 600; 

/**
 * Ermittelt das aktuelle Gesamteinkommen pro Sekunde ($/s) aus Skripten und Gang.
 */
function getIncomePerSecond(ns: NS): number {
  let income = 0;
  try {
    const scriptInc = ns.getTotalScriptIncome();
    income += Array.isArray(scriptInc) ? scriptInc[0] : scriptInc;
  } catch {}

  try {
    if (ns.gang && ns.gang.inGang()) {
      // moneyGainRate ist pro Game-Tick (5 Ticks pro Sekunde)
      income += ns.gang.getGangInformation().moneyGainRate * 5;
    }
  } catch {}

  return income;
}

/**
 * Hilfsfunktion zur Leserlichen Formatierung von Zeiten.
 */
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
    return;
  }

  const sing = ns.singularity;
  const player = ns.getPlayer();
  const myFactions = player.factions;
  const NFG_NAME = "NeuroFlux Governor";

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
  logReport("🛍️ SHOPPING REPORT - " + new Date().toLocaleTimeString());
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

  logReport(`📋 Scanner-Ergebnis: ${shoppingList.length} einzigartige Augmentations qualifiziert.`);

  // 2. INTELLIGENTE EINKAUFSSCHLEIFE (Mit Warte-Formel)
  let keepShopping = true;
  let isWaitingForAug = false;

  while (keepShopping) {
    keepShopping = false;
    const currentOwnedAndQueued = sing.getOwnedAugmentations(true);
    const currentMoney = ns.getPlayer().money;
    const incomePerSec = getIncomePerSecond(ns);

    // Aktualisiere aktuelle Preise & filtere fehlende Voraussetzungen
    type ValidCandidate = AugShoppingItem & { currentPrice: number };
    let candidateList: ValidCandidate[] = [];

    for (const item of shoppingList) {
      const prereqs = sing.getAugmentationPrereq(item.name);
      const missingPrereqs = prereqs.filter((p) => !currentOwnedAndQueued.includes(p));

      if (missingPrereqs.length > 0) {
        const prereqOnList = missingPrereqs.every((p) => shoppingList.some((s) => s.name === p));
        if (!prereqOnList) {
          logReport(`⚠️ Skip ${item.name}: Voraussetzung fehlt im Besitz (${missingPrereqs.join(", ")})`);
        }
        continue;
      }

      const currentPrice = sing.getAugmentationPrice(item.name);
      candidateList.push({ ...item, currentPrice });
    }

    // Sortiere TEUERSTE ZUERST für die Entscheidungskette
    candidateList.sort((a, b) => b.currentPrice - a.currentPrice);

    if (candidateList.length === 0) break;

    // Prüfe Liste von oben nach unten (Top-Down)
    for (const candidate of candidateList) {
      if (currentMoney >= candidate.currentPrice) {
        // KAUFEN! (Da wir von oben prüfen, ist dies das teuerste bezahlbare Augment)
        logReport(`[SHOP] Versuche Kauf: ${candidate.name} von ${candidate.faction} ($${ns.format.number(candidate.currentPrice)})`);
        const success = sing.purchaseAugmentation(candidate.faction, candidate.name);

        if (success) {
          logReport(`✅ ERFOLGREICH GEKAUFT: ${candidate.name} (${candidate.faction})`);
          shoppingList = shoppingList.filter((s) => s.name !== candidate.name);
          keepShopping = true; // Preise aller anderen Augments haben sich um ~1.9x erhöht -> Neu evaluieren!
          break;
        } else {
          logReport(`❌ Interner API-Fehler beim Kauf von ${candidate.name}`);
        }
      } else {
        // UNBEZAHLBAR -> Prüfe Wartezeit-Formel
        const neededMoney = candidate.currentPrice - currentMoney;
        const timeToWaitSeconds = incomePerSec > 0 ? neededMoney / incomePerSec : Infinity;

        if (timeToWaitSeconds <= MAX_WAIT_TIME_SECONDS) {
          logReport(`⏳ WARTE-STRATEGIE AKTIV:`);
          logReport(`   Nächstes Ziel: ${candidate.name} (${candidate.faction})`);
          logReport(`   Preis: $${ns.format.number(candidate.currentPrice)} | Fehlt: $${ns.format.number(neededMoney)}`);
          logReport(`   Einkommen: $${ns.format.number(incomePerSec)}/s`);
          logReport(`   Geschätzte Sparzeit: ~${formatTime(timeToWaitSeconds)} (Limit: ${formatTime(MAX_WAIT_TIME_SECONDS)})`);
          logReport(`   🛑 Kauf günstigerer Augmentations gestoppt, um $1.9x Preisanstieg zu vermeiden.\n`);
          
          isWaitingForAug = true;
          keepShopping = false; // Bricht gesamte Shopping-Schleife ab!
          break;
        } else {
          // Wartezeit zu lang -> Überspringen und nächstgünstigeres Augment prüfen
          logReport(`ℹ️ Wartezeit für ${candidate.name} ($${ns.format.number(candidate.currentPrice)}) zu lang (~${formatTime(timeToWaitSeconds)}). Prüfe günstigere Alternativen...`);
        }
      }
    }
  }

  // 3. LATE-GAME EXTRA-PHASE: NEUROFLUX GOVERNOR DUMP
  // Wird NUR ausgeführt, wenn wir aktuell NICHT auf ein reguläres Augment sparen!
  if (isWaitingForAug) {
    logReport("🔄 Phase 2: NeuroFlux Governor Dump übersprungen (Geld wird für reguläres Augment gespart).");
  } else {
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
      logReport(`📈 NEUROFLUX UPGRADES: Insgesamt ${nfgCount} Stufen investiert.`);
    } else {
      logReport("ℹ️ Kein NeuroFlux Governor gekauft.");
    }
  }

  logReport("\n🏁 Report Ende.");
  await ns.write("/temp/shop-report.txt", report.join("\n"), "w");
}