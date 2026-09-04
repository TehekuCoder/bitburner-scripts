import { NS, FactionName } from "@ns";
import { getPurchasedUninstalledAugs } from "../../strategy/player.js";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/shared/types/finance.js";
import {
  hasSingularity,
  loadBnMults,
  adjustPriorityByMult,
} from "/lib/utils.js";
import { runEvaluator } from "../evaluator-runner.js";
import { AUG_PRICE_MULT } from "../../../shared/constants/game-defaults";
import { PATHS } from "/infrastructure/runtime/paths.js";
import { getBestNeuroFluxTarget } from "../../player/neuroflux.js";

interface AugCandidate {
  name: string;
  faction: FactionName;
  price: number;
  repReq: number;
  isGang: boolean;
  etaSeconds: number;
}

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
          cache.repPerSec === 0
            ? instantRate
            : cache.repPerSec * 0.7 + instantRate * 0.3;
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

    const prereqCache = new Map<string, string[]>();
    const getPrereqs = (name: string) => {
      if (!prereqCache.has(name))
        prereqCache.set(name, sing.getAugmentationPrereq(name));
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
    const readyMap = new Map<string, AugCandidate>(
      readyCandidates.map((c) => [c.name, c]),
    );
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
      isPrereqChainSatisfied(aug.name),
    );

    if (fulfillableCandidates.length === 0) return requests;

    const currentMoney = ns.getServerMoneyAvailable("home");

    // --- FALL 1: BEREITS IM KAUFMODUS ---
    if (hasStartedBuying) {
      const immediateBuyable = fulfillableCandidates.filter(
        (aug) =>
          getPrereqs(aug.name).every((p) => ownedAugs.includes(p)) &&
          aug.price <= currentMoney,
      );

      if (immediateBuyable.length === 0) return requests;

      immediateBuyable.sort((a, b) => b.price - a.price);
      const nextTarget = immediateBuyable[0];

      requests.push({
        id: `player-aug-dump-${nextTarget.name}`,
        category: "PLAYER_AUG" as PurchaseCategory,
        priority: adjustPriorityByMult(
          PurchasePriority.CRITICAL,
          efficiencyMult,
        ),
        score: Math.max(1, Math.floor(100 * efficiencyMult)),
        cost: nextTarget.price,
        description: `Batch Dump: ${nextTarget.name}`,
        action: {
          script: PATHS.app.actions.singularity,
          args: ["player-purchase-aug", nextTarget.faction, nextTarget.name],
        },
      });
      return requests;
    }

    // Sonderfall Red Pill: Wenn verfügbar und bezahlbar, SOFORT kaufen!
    const redPillCand = fulfillableCandidates.find(
      (a) => a.name === "The Red Pill",
    );
    if (redPillCand && redPillCand.price <= currentMoney) {
      requests.push({
        id: "player-aug-redpill",
        category: "PLAYER_AUG" as PurchaseCategory,
        priority: PurchasePriority.CRITICAL,
        score: 100,
        cost: redPillCand.price,
        description: "CRITICAL: The Red Pill Purchase",
        action: {
          script: PATHS.app.actions.singularity,
          args: ["player-purchase-aug", redPillCand.faction, redPillCand.name],
        },
      });
      return requests;
    }

    // --- FALL 2: DYNAMISCHE BATCH-BERECHNUNG ---
    const baseTargetBatch = Math.max(
      3,
      Math.min(8, Math.floor(6 / (costMult || 1))),
    );

    // 1. Auswählen: Nach Basispreis AUFSTEIGEND sortieren (Günstigste bevorzugen)
    const sortedByPriceAsc = [...fulfillableCandidates].sort(
      (a, b) => a.price - b.price,
    );
    const effectiveBatchTarget = Math.min(
      baseTargetBatch,
      sortedByPriceAsc.length,
    );

    const selectedBatch: AugCandidate[] = [];
    let cumulativeCost = 0;
    let currentMultiplier = 1.0;

    for (const cand of sortedByPriceAsc) {
      const prereqs = getPrereqs(cand.name).filter(
        (p) => !ownedAugs.includes(p),
      );
      const missingPrereqs = prereqs.filter(
        (p) => !selectedBatch.some((b) => b.name === p),
      );

      if (missingPrereqs.length > 0) continue;

      const stepCost = cand.price * currentMultiplier;
      if (cumulativeCost + stepCost <= currentMoney) {
        selectedBatch.push(cand);
        cumulativeCost += stepCost;
        currentMultiplier *= AUG_PRICE_MULT;
      }

      if (selectedBatch.length >= effectiveBatchTarget) break;
    }

    // 2. Kaufen: Gewählte Augments ABSTEIGEND nach Preis sortieren (Teuerste zuerst kaufen)
    const affordableBatch = [...selectedBatch].sort(
      (a, b) => b.price - a.price,
    );

    const hasRedPill = fulfillableCandidates.some(
      (a) => a.name === "The Red Pill",
    );
    const reachesTarget = affordableBatch.length >= effectiveBatchTarget;
    const isOutofAugs =
      sortedByPriceAsc.length < baseTargetBatch &&
      affordableBatch.length === sortedByPriceAsc.length;

    if (
      reachesTarget ||
      isOutofAugs ||
      (hasRedPill && affordableBatch.length > 0)
    ) {
      requests.push({
        id: "player-aug-batch",
        category: "PLAYER_AUG" as PurchaseCategory,
        priority: adjustPriorityByMult(PurchasePriority.HIGH, efficiencyMult),
        score: Math.max(1, Math.floor(85 * efficiencyMult)),
        cost: cumulativeCost,
        description: `Dynamic Aug Batch (${affordableBatch.length}/${effectiveBatchTarget} Items, Cost: ${ns.format.number(cumulativeCost)})`,
        action: {
          script: PATHS.app.actions.singularity,
          args: [
            "player-purchase-aug-batch",
            JSON.stringify(
              affordableBatch.map((a) => ({
                faction: a.faction,
                name: a.name,
              })),
            ),
          ],
        },
      });
    }
    // --- FALL 3: NEUROFLUX GOVERNOR DUMP ---
    // Wenn keine normalen Augmentations mehr verfügbar/bezahlbar sind, Geld in NeuroFlux stecken
    const nfgTarget = getBestNeuroFluxTarget(ns);
    if (nfgTarget && currentMoney >= nfgTarget.price) {
      requests.push({
        id: `player-aug-nfg-${Date.now()}`,
        category: "PLAYER_AUG" as PurchaseCategory,
        priority: adjustPriorityByMult(PurchasePriority.MEDIUM, efficiencyMult),
        score: 50,
        cost: nfgTarget.price,
        description: `NeuroFlux Governor Level Up via ${nfgTarget.faction}`,
        action: {
          script: PATHS.app.actions.singularity,
          args: ["player-purchase-nfg", nfgTarget.faction],
        },
      });
    }

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, PlayerEvaluator);
}
