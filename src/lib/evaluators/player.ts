import { NS, FactionName } from "@ns";
import { getPurchasedUninstalledAugs } from "/lib/player.js";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/lib/types/finance.js";
import { AUG_PRICE_MULT } from "/lib/constants.js";
import { hasSingularity, loadBnMults, adjustPriorityByMult } from "/lib/utils.js";
import { runEvaluator } from "/lib/evaluator-runner.js";

interface AugCandidate {
  name: string;
  faction: FactionName;
  price: number;
  repReq: number;
  isGang: boolean;
  etaSeconds: number;
}

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
        gangRepPerSec =
          gangRepPerSec === 0 ? instantRate : gangRepPerSec * 0.7 + instantRate * 0.3;
      }
    }

    lastGangRep = currentRep;
    lastGangTime = now;
  } catch {
    gangRepPerSec = 0;
  }
}

function isPrereqChainSatisfied(
  augName: string,
  sing: NS["singularity"],
  ownedAugs: string[],
  availableNames: Set<string>
): boolean {
  const prereqs = sing.getAugmentationPrereq(augName);
  for (const p of prereqs) {
    if (!ownedAugs.includes(p)) {
      if (!availableNames.has(p)) return false;
      if (!isPrereqChainSatisfied(p, sing, ownedAugs, availableNames)) return false;
    }
  }
  return true;
}

function sortAugsWithPrereqs(
  augs: AugCandidate[],
  sing: NS["singularity"],
  ownedAugs: string[]
): AugCandidate[] {
  const result: AugCandidate[] = [];
  const remaining = [...augs];

  while (remaining.length > 0) {
    const validNext = remaining.filter((aug) => {
      const prereqs = sing.getAugmentationPrereq(aug.name);
      return prereqs.every(
        (p) => ownedAugs.includes(p) || result.some((r) => r.name === p)
      );
    });

    if (validNext.length === 0) break;

    validNext.sort((a, b) => b.price - a.price);
    const chosen = validNext[0];

    result.push(chosen);
    const idx = remaining.findIndex((r) => r.name === chosen.name);
    if (idx !== -1) remaining.splice(idx, 1);
  }

  return result;
}

export const PlayerEvaluator: PurchaseEvaluator = {
  category: "PLAYER_AUG" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    const requests: PurchaseRequest[] = [];
    if (!hasSingularity(ns)) return requests;

    const bnMults = loadBnMults(ns);
    const costMult = bnMults.AugmentationMoneyCost ?? 1.0;
    const efficiencyMult = costMult > 0 ? 1 / costMult : 1.0;

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
        if (
          aug === "NeuroFlux Governor" ||
          ownedAugs.includes(aug) ||
          scannedAugNames.has(aug)
        ) {
          continue;
        }

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
            candidates.push({
              name: aug,
              faction,
              price,
              repReq,
              isGang,
              etaSeconds,
            });
            scannedAugNames.add(aug);
          }
        }
      }
    }

    if (candidates.length === 0) return requests;

    const readyCandidates = candidates.filter((item) => item.etaSeconds === 0);
    const readyMap = new Map<string, AugCandidate>(readyCandidates.map((c) => [c.name, c]));
    const readyNames = new Set<string>(readyMap.keys());

    const fulfillableCandidates = readyCandidates.filter((aug) =>
      isPrereqChainSatisfied(aug.name, sing, ownedAugs, readyNames)
    );

    if (fulfillableCandidates.length === 0) return requests;

    const currentMoney = ns.getServerMoneyAvailable("home");

    // -------------------------------------------------------------
    // FALL 1: BEREITS IM KAUFMODUS
    // -------------------------------------------------------------
    if (hasStartedBuying) {
      const immediateBuyable = fulfillableCandidates.filter(
        (aug) =>
          sing.getAugmentationPrereq(aug.name).every((p) => ownedAugs.includes(p)) &&
          aug.price <= currentMoney
      );

      if (immediateBuyable.length === 0) return requests;

      immediateBuyable.sort((a, b) => b.price - a.price);
      const nextTarget = immediateBuyable[0];

      const priority = adjustPriorityByMult(PurchasePriority.CRITICAL, efficiencyMult);
      const score = Math.max(1, Math.floor(100 * efficiencyMult));

      requests.push({
        id: `player-aug-dump-${nextTarget.name}`,
        category: "PLAYER_AUG" as PurchaseCategory,
        priority,
        score,
        cost: nextTarget.price,
        description: `Batch Dump: ${nextTarget.name}`,
        action: {
          script: "core/actions/act-singularity.js",
          args: ["player-purchase-aug", nextTarget.faction, nextTarget.name],
        },
      });
      return requests;
    }

    // -------------------------------------------------------------
    // FALL 2: BATCH-PLANUNG
    // -------------------------------------------------------------
    const batchCandidates: AugCandidate[] = [];
    const batchNames = new Set<string>();

    const sortedFulfillable = [...fulfillableCandidates].sort((a, b) => a.price - b.price);

    for (const cand of sortedFulfillable) {
      if (batchCandidates.length >= 10) break;
      if (batchNames.has(cand.name)) continue;

      const addWithPrereqs = (name: string) => {
        const prereqs = sing.getAugmentationPrereq(name);
        for (const p of prereqs) {
          if (!ownedAugs.includes(p) && !batchNames.has(p)) {
            addWithPrereqs(p);
          }
        }
        if (!batchNames.has(name) && readyMap.has(name)) {
          batchCandidates.push(readyMap.get(name)!);
          batchNames.add(name);
        }
      };

      addWithPrereqs(cand.name);
    }

    if (batchCandidates.length === 0) return requests;

    const orderedBatch = sortAugsWithPrereqs(batchCandidates, sing, ownedAugs);

    let totalBatchCost = 0;
    let currentMult = 1.0;
    for (const aug of orderedBatch) {
      totalBatchCost += aug.price * currentMult;
      currentMult *= AUG_PRICE_MULT;
    }

    const hasRedPill = orderedBatch.some((a) => a.name === "The Red Pill");
    const canAffordFullBatch = currentMoney >= totalBatchCost;

    if (canAffordFullBatch || hasRedPill) {
      const priority = adjustPriorityByMult(PurchasePriority.CRITICAL, efficiencyMult);
      const score = Math.max(1, Math.floor(100 * efficiencyMult));

      requests.push({
        id: "player-aug-batch",
        category: "PLAYER_AUG" as PurchaseCategory,
        priority,
        score,
        cost: canAffordFullBatch ? totalBatchCost : currentMoney,
        description: `Augmentation Batch (${orderedBatch.length} Items)`,
        action: {
          script: "core/actions/act-singularity.js",
          args: ["player-purchase-aug-batch", JSON.stringify(orderedBatch)],
        },
      });
    }

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, PlayerEvaluator);
}