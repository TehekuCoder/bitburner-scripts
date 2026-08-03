// lib/evaluators/player.ts
import { NS, FactionName } from "@ns";
import { getPurchasedUninstalledAugs } from "/lib/player.js";
import { PurchaseEvaluator, PurchaseRequest, PurchasePriority } from "/lib/types/finance.js";
import { AUG_PRICE_MULT } from "/lib/constants.js";
import { runEvaluator } from "/lib/evaluator-runner.js";

interface AugCandidate {
  name: string;
  faction: FactionName;
  price: number;
  repReq: number;
  isGang: boolean;
  etaSeconds: number; // 0 = bereits freigeschaltet
}

// Speicher für Gang-Rep-Velocity
let lastGangRep = 0;
let lastGangTime = 0;
let gangRepPerSec = 0;

function updateGangVelocity(ns: NS): void {
  try {
    if (!ns.gang?.inGang()) return;
    const currentRep = ns.gang.getGangInformation().respect;
    const now = Date.now();

    if (lastGangTime > 0 && now > lastGangTime) {
      const dt = (now - lastGangTime) / 1000;
      const dRep = currentRep - lastGangRep;
      if (dt > 0 && dRep >= 0) {
        const instantRate = dRep / dt;
        gangRepPerSec = gangRepPerSec === 0 ? instantRate : gangRepPerSec * 0.7 + instantRate * 0.3;
      }
    }

    lastGangRep = currentRep;
    lastGangTime = now;
  } catch {
    gangRepPerSec = 0;
  }
}

export const PlayerEvaluator: PurchaseEvaluator = {
  category: "PLAYER_AUG",

  getRequests(ns: NS): PurchaseRequest[] {
    const requests: PurchaseRequest[] = [];
    if (!ns.singularity) return requests;

    updateGangVelocity(ns);

    const sing = ns.singularity;
    const ownedAugs = sing.getOwnedAugmentations(true);
    const uninstalled = getPurchasedUninstalledAugs(ns);
    const hasStartedBuying = uninstalled.length > 0;

    const factionsToScan = new Set<FactionName>(ns.getPlayer().factions);
    let gangFactionName: FactionName | null = null;

    try {
      if (ns.gang?.inGang()) {
        gangFactionName = ns.gang.getGangInformation().faction as FactionName;
        factionsToScan.add(gangFactionName);
      }
    } catch {}

    const candidates: AugCandidate[] = [];
    const scannedAugNames = new Set<string>();

    for (const faction of factionsToScan) {
      const isGang = faction === gangFactionName;
      const currentRep = sing.getFactionRep(faction);

      for (const aug of sing.getAugmentationsFromFaction(faction)) {
        if (aug === "NeuroFlux Governor" || ownedAugs.includes(aug) || scannedAugNames.has(aug)) continue;

        const repReq = sing.getAugmentationRepReq(aug);
        let etaSeconds = 0;

        if (currentRep < repReq) {
          if (isGang && gangRepPerSec > 0) {
            etaSeconds = (repReq - currentRep) / gangRepPerSec;
          } else {
            continue;
          }
        }

        if (etaSeconds <= 180) {
          const price = sing.getAugmentationPrice(aug);
          if (Number.isFinite(price) && price > 0) {
            candidates.push({ name: aug, faction, price, repReq, isGang, etaSeconds });
            scannedAugNames.add(aug);
          }
        }
      }
    }

    const pendingHighTierGangAug = candidates.some((c) => c.isGang && c.etaSeconds > 0 && c.price > 1_000_000_000);

    const readyCandidates = candidates.filter((item) => {
      if (item.etaSeconds > 0) return false;
      return sing.getAugmentationPrereq(item.name).every((p) => ownedAugs.includes(p) || scannedAugNames.has(p));
    });

    readyCandidates.sort((a, b) => {
      if (sing.getAugmentationPrereq(b.name).includes(a.name)) return -1;
      if (sing.getAugmentationPrereq(a.name).includes(b.name)) return 1;
      return b.price - a.price;
    });

    if (readyCandidates.length === 0) return requests;

    const currentMoney = ns.getServerMoneyAvailable("home");

    // FALL 1: Wir haben bereits angefangen zu kaufen
    if (hasStartedBuying) {
      const nextTarget = readyCandidates[0];
      requests.push({
        id: `player-aug-dump-${nextTarget.name}`,
        category: "PLAYER_AUG",
        priority: PurchasePriority.CRITICAL,
        score: 100,
        cost: nextTarget.price,
        description: `Batch Dump: ${nextTarget.name}`,
        action: {
          script: "core/actions/act-singularity.js",
          args: ["player-purchase-aug", nextTarget.faction, nextTarget.name],
        },
      });
      return requests;
    }

    // FALL 2: Noch nichts gekauft -> Warten auf optimalen Batch
    if (pendingHighTierGangAug && currentMoney < 50_000_000_000) {
      return requests;
    }

    // KORRIGIERTE BATCH-BERECHNUNG
    let simulatedCost = 0;
    let currentMult = 1.0;
    const batchToBuy: AugCandidate[] = [];
    const MAX_BATCH_SIZE = 6; // Verhindert Systemüberlastung durch zu große Pakete

    for (const aug of readyCandidates) {
      const scaledPrice = aug.price * currentMult;
      const nextTotalCost = simulatedCost + scaledPrice;

      // Prüfen, ob das nächste Augment unser aktuelles Geld übersteigen würde
      if (nextTotalCost > currentMoney) {
        // Haben wir bereits 3 oder mehr Augs, die wir uns JETZT leisten können?
        if (batchToBuy.length >= 3) {
          // Stopp! Wir kaufen JETZT genau diese bezahlbare Menge!
          break;
        }

        // Falls wir noch keine 3 Items haben, fügen wir es als Sparziel hinzu
        batchToBuy.push(aug);
        simulatedCost = nextTotalCost;
        currentMult *= AUG_PRICE_MULT;

        // Sparziel fest auf maximal 3 Items deckeln, damit das Ziel nicht wegläuft!
        if (batchToBuy.length >= 3) {
          break;
        }
      } else {
        // Wir können es uns leisten -> Hinzufügen
        batchToBuy.push(aug);
        simulatedCost = nextTotalCost;
        currentMult *= AUG_PRICE_MULT;

        // Maximal-Limit für einen einzelnen Kauf-Batch erreicht
        if (batchToBuy.length >= MAX_BATCH_SIZE) {
          break;
        }
      }
    }

    const isAffordable = currentMoney >= simulatedCost;
    const includesRedPill = batchToBuy.some((a) => a.name === "The Red Pill");

    if (batchToBuy.length >= 2 || includesRedPill || currentMoney > 100_000_000_000) {
      requests.push({
        id: isAffordable ? "player-aug-batch" : "player-aug-saving",
        category: "PLAYER_AUG",
        priority: isAffordable ? PurchasePriority.CRITICAL : PurchasePriority.HIGH,
        score: isAffordable ? 100 : 90,
        cost: simulatedCost,
        description: `${isAffordable ? "Augmentation Batch" : "Sparziel: Aug Batch"} (${batchToBuy.length} Items)`,
        action: {
          script: "core/actions/act-singularity.js",
          args: ["player-purchase-aug-batch", JSON.stringify(batchToBuy)],
        },
      });
    }

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, PlayerEvaluator);
}