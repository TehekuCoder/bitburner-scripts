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

// Persistenter Speicherbereich über Skript-Neustarts hinweg
interface GangStateCache {
  lastRep: number;
  lastTime: number;
  repPerSec: number;
}

const g = globalThis as unknown as { __gangStateCache?: GangStateCache };
g.__gangStateCache ??= { lastRep: 0, lastTime: 0, repPerSec: 0 };

function updateGangVelocity(ns: NS): number {
  try {
    if (!ns.gang?.inGang()) return 0;
    const cache = g.__gangStateCache!;
    const currentRep = ns.gang.getGangInformation().respect;
    const now = Date.now();

    if (cache.lastTime > 0 && now > cache.lastTime) {
      const dt = (now - cache.lastTime) / 1000;
      const dRep = currentRep - cache.lastRep;
      if (dt > 0 && dRep >= 0) {
        const instantRate = dRep / dt;
        cache.repPerSec =
          cache.repPerSec === 0 ? instantRate : cache.repPerSec * 0.7 + instantRate * 0.3;
      }
    }

    cache.lastRep = currentRep;
    cache.lastTime = now;
    return cache.repPerSec;
  } catch {
    return 0;
  }
}

export const PlayerEvaluator: PurchaseEvaluator = {
  category: "PLAYER_AUG" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    const requests: PurchaseRequest[] = [];
    if (!hasSingularity(ns)) return requests;

    const sing = ns.singularity;
    const bnMults = loadBnMults(ns);
    const costMult = bnMults.AugmentationMoneyCost ?? 1.0;
    const efficiencyMult = costMult > 0 ? 1 / costMult : 1.0;

    const gangRepPerSec = updateGangVelocity(ns);

    // Singularity Call Caching für diesen Durchlauf
    const prereqCache = new Map<string, string[]>();
    const getPrereqs = (name: string) => {
      if (!prereqCache.has(name)) prereqCache.set(name, sing.getAugmentationPrereq(name));
      return prereqCache.get(name)!;
    };

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

    const isPrereqChainSatisfied = (augName: string): boolean => {
      const prereqs = getPrereqs(augName);
      for (const p of prereqs) {
        if (!ownedAugs.includes(p)) {
          if (!readyNames.has(p)) return false;
          if (!isPrereqChainSatisfied(p)) return false;
        }
      }
      return true;
    };

    const fulfillableCandidates = readyCandidates.filter((aug) =>
      isPrereqChainSatisfied(aug.name)
    );

    if (fulfillableCandidates.length === 0) return requests;

    const currentMoney = ns.getServerMoneyAvailable("home");

    // FALL 1: BEREITS IM KAUFMODUS
    if (hasStartedBuying) {
      const immediateBuyable = fulfillableCandidates.filter(
        (aug) =>
          getPrereqs(aug.name).every((p) => ownedAugs.includes(p)) &&
          aug.price <= currentMoney
      );

      if (immediateBuyable.length === 0) return requests;

      immediateBuyable.sort((a, b) => b.price - a.price);
      const nextTarget = immediateBuyable[0];

      requests.push({
        id: `player-aug-dump-${nextTarget.name}`,
        category: "PLAYER_AUG" as PurchaseCategory,
        priority: adjustPriorityByMult(PurchasePriority.CRITICAL, efficiencyMult),
        score: Math.max(1, Math.floor(100 * efficiencyMult)),
        cost: nextTarget.price,
        description: `Batch Dump: ${nextTarget.name}`,
        action: {
          script: "core/actions/act-singularity.js",
          args: ["player-purchase-aug", nextTarget.faction, nextTarget.name],
        },
      });
      return requests;
    }

    // FALL 2: BATCH-PLANUNG
    const batchCandidates: AugCandidate[] = [];
    const batchNames = new Set<string>();
    const sortedFulfillable = [...fulfillableCandidates].sort((a, b) => a.price - b.price);

    for (const cand of sortedFulfillable) {
      if (batchCandidates.length >= 10) break;
      if (batchNames.has(cand.name)) continue;

      const addWithPrereqs = (name: string) => {
        const prereqs = getPrereqs(name);
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

    // Topologische Sortierung der Augmentations
    const orderedBatch: AugCandidate[] = [];
    const remaining = [...batchCandidates];

    while (remaining.length > 0) {
      const validNext = remaining.filter((aug) =>
        getPrereqs(aug.name).every(
          (p) => ownedAugs.includes(p) || orderedBatch.some((r) => r.name === p)
        )
      );

      if (validNext.length === 0) break;
      validNext.sort((a, b) => b.price - a.price);

      const chosen = validNext[0];
      orderedBatch.push(chosen);
      const idx = remaining.findIndex((r) => r.name === chosen.name);
      if (idx !== -1) remaining.splice(idx, 1);
    }

    let totalBatchCost = 0;
    let currentMult = 1.0;
    for (const aug of orderedBatch) {
      totalBatchCost += aug.price * currentMult;
      currentMult *= AUG_PRICE_MULT;
    }

    const hasRedPill = orderedBatch.some((a) => a.name === "The Red Pill");
    const canAffordFullBatch = currentMoney >= totalBatchCost;

    // Nur Anfragen erstellen, wenn der Batch komplett bezahlbar ist oder Red Pill gekauft werden kann
    if (canAffordFullBatch || hasRedPill) {
      requests.push({
        id: "player-aug-batch",
        category: "PLAYER_AUG" as PurchaseCategory,
        priority: adjustPriorityByMult(PurchasePriority.CRITICAL, efficiencyMult),
        score: Math.max(1, Math.floor(100 * efficiencyMult)),
        // Verhindert das Blockieren des gesamten Finance-Budgets, wenn Red Pill noch unbezahlbar ist
        cost: canAffordFullBatch ? totalBatchCost : Math.min(currentMoney, totalBatchCost),
        description: `Augmentation Batch (${orderedBatch.length} Items)`,
        action: {
          script: "core/actions/act-singularity.js",
          args: ["player-purchase-aug-batch", JSON.stringify(orderedBatch.map(a => ({ faction: a.faction, name: a.name })))],
        },
      });
    }

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, PlayerEvaluator);
}