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
}

function getAugCostMult(ns: NS): number {
  return AUG_PRICE_MULT;
}

function calculateDynamicMinBatchSize(ns: NS, costMult: number, candidateCount: number): number {
  const money = ns.getServerMoneyAvailable("home");
  if (money > 5_000_000_000) return Math.min(candidateCount, 5);
  if (money > 1_000_000_000) return Math.min(candidateCount, 3);
  return Math.min(candidateCount, 1);
}

export const PlayerEvaluator: PurchaseEvaluator = {
  category: "PLAYER_AUG",

  getRequests(ns: NS): PurchaseRequest[] {
    const requests: PurchaseRequest[] = [];
    if (!ns.singularity) return requests;

    const sing = ns.singularity;
    const ownedAugs = sing.getOwnedAugmentations(true);
    const uninstalled = getPurchasedUninstalledAugs(ns);
    const hasStartedBuying = uninstalled.length > 0;

    const candidates: AugCandidate[] = [];
    const factionsToScan = new Set<FactionName>(ns.getPlayer().factions);
    
    try { if (ns.gang?.inGang()) factionsToScan.add(ns.gang.getGangInformation().faction as FactionName); } catch {}

    const scannedAugNames = new Set<string>();

    for (const faction of factionsToScan) {
      for (const aug of sing.getAugmentationsFromFaction(faction)) {
        if (aug === "NeuroFlux Governor" || ownedAugs.includes(aug) || scannedAugNames.has(aug)) continue;

        if (sing.getFactionRep(faction) >= sing.getAugmentationRepReq(aug)) {
          const price = sing.getAugmentationPrice(aug);
          if (Number.isFinite(price) && price > 0) {
            candidates.push({ name: aug, faction, price, repReq: sing.getAugmentationRepReq(aug) });
            scannedAugNames.add(aug);
          }
        }
      }
    }

    const validCandidates = candidates.filter((item) => {
      return sing.getAugmentationPrereq(item.name).every((p) => ownedAugs.includes(p) || scannedAugNames.has(p));
    }).sort((a, b) => {
      if (sing.getAugmentationPrereq(b.name).includes(a.name)) return -1;
      if (sing.getAugmentationPrereq(a.name).includes(b.name)) return 1;
      return b.price - a.price; 
    });

    if (!hasStartedBuying) {
      if (validCandidates.length === 0) return requests;

      const minBatchSize = calculateDynamicMinBatchSize(ns, getAugCostMult(ns), validCandidates.length);
      const targetCount = Math.min(minBatchSize, validCandidates.length);
      const currentMoney = ns.getServerMoneyAvailable("home");
      
      let simulatedCost = 0, currentMult = 1.0;
      const batchToBuy: AugCandidate[] = [];

      for (const aug of validCandidates) {
        const scaledPrice = aug.price * currentMult;
        if (batchToBuy.length < targetCount || currentMoney >= simulatedCost + scaledPrice) {
          simulatedCost += scaledPrice;
          batchToBuy.push(aug);
          currentMult *= AUG_PRICE_MULT;
        }
      }

      const isAffordable = currentMoney >= simulatedCost;
      requests.push({
        id: isAffordable ? "player-aug-batch" : "player-aug-saving",
        category: "PLAYER_AUG",
        priority: isAffordable ? PurchasePriority.CRITICAL : PurchasePriority.HIGH,
        score: isAffordable ? 100 : 95, // Priorisiert Sparen/Kauf über die meisten anderen Dinge
        cost: simulatedCost,
        description: `${isAffordable ? 'Augmentation Batch' : 'Sparziel: Aug Batch'} (${batchToBuy.length} Items)`,
        action: {
          script: "core/actions/act-singularity.js",
          args: ["player-purchase-aug-batch", JSON.stringify(batchToBuy)],
        },
      });
    } else {
      if (validCandidates.length > 0) {
        const nextTarget = validCandidates[0];
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
      } else {
        let bestNFGFaction: FactionName | null = null;
        let highestRep = -1;
        const nfgReq = sing.getAugmentationRepReq("NeuroFlux Governor");

        for (const faction of factionsToScan) {
          const rep = sing.getFactionRep(faction);
          if (rep >= nfgReq && rep > highestRep) {
            highestRep = rep;
            bestNFGFaction = faction;
          }
        }

        if (bestNFGFaction) {
          requests.push({
            id: `player-aug-nfg-dump`,
            category: "PLAYER_AUG",
            priority: PurchasePriority.HIGH,
            score: 90,
            cost: sing.getAugmentationPrice("NeuroFlux Governor"),
            description: `NeuroFlux Governor Dump (${bestNFGFaction})`,
            action: {
              script: "core/actions/act-singularity.js",
              args: ["player-purchase-nfg", bestNFGFaction],
            },
          });
        }
      }
    }

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, PlayerEvaluator);
}
