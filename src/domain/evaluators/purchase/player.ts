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
import { hashString } from "/lib/hash.js";

interface AugCandidate {
  name: string;
  faction: FactionName;
  price: number;
  repReq: number;
  isGang: boolean;
  etaSeconds: number;
}

function getAugBatchRequestId(
  batch: Pick<AugCandidate, "faction" | "name">[],
): string {
  return `player-aug-batch-${hashString(JSON.stringify(batch))}`;
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

    const ownedAugs = sing.getOwnedAugmentations(true);
    const uninstalled = getPurchasedUninstalledAugs(ns);
    const currentMoney = ns.getServerMoneyAvailable("home");
    const gangFaction = ns.gang?.inGang()
      ? (ns.gang.getGangInformation().faction as FactionName)
      : null;

    if (uninstalled.length > 0) {
      const installRequestId = `player-install-augs-${hashString(
        JSON.stringify(uninstalled),
      )}`;
      requests.push({
        id: installRequestId,
        category: "PLAYER_AUG",
        priority: PurchasePriority.CRITICAL,
        score: 100,
        cost: 0,
        description: `Installiere Augmentations (${uninstalled.length} bereit)`,
        action: {
          script: PATHS.app.actions.singularity,
          args: ["player-install-augs", "init.js", installRequestId],
        },
      });
      return requests;
    }

    // --- 1. CANDIDATES SCANNEN ---
    const factionsToScan = new Set<FactionName>(ns.getPlayer().factions);
    try {
      if (ns.gang?.inGang()) {
        factionsToScan.add(ns.gang.getGangInformation().faction as FactionName);
      }
    } catch {}

    const candidates: AugCandidate[] = [];
    const scannedAugNames = new Set<string>();

    for (const faction of factionsToScan) {
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
        if (currentRep >= repReq) {
          const price = sing.getAugmentationPrice(aug);
          if (Number.isFinite(price) && price > 0) {
            candidates.push({
              name: aug,
              faction,
              price,
              repReq,
              isGang: faction === gangFaction,
              etaSeconds: 0,
            });
            scannedAugNames.add(aug);
          }
        }
      }
    }

    if (candidates.length === 0) return requests;

    // --- FALL 1: RED PILL CHECK ---
    const redPillCand = candidates.find((a) => a.name === "The Red Pill");
    if (redPillCand && redPillCand.price <= currentMoney) {
      requests.push({
        id: "player-aug-redpill",
        category: "PLAYER_AUG",
        priority: PurchasePriority.CRITICAL, // ⚡ CRITICAL: Win-Condition
        score: 100,
        cost: redPillCand.price,
        description: "CRITICAL: The Red Pill Purchase",
        action: {
          script: PATHS.app.actions.singularity,
          args: [
            "player-purchase-aug",
            redPillCand.faction,
            redPillCand.name,
            redPillCand.price,
          ],
        },
      });
      return requests;
    }

    // --- FALL 2: BATCH-EVALUIERUNG UND CRITICAL-PROMOTION ---
    const baseTargetBatch = Math.max(3, Math.min(8, Math.floor(6 / (costMult || 1))));
    const sortedByPriceAsc = [...candidates].sort((a, b) => a.price - b.price);

    const selectedBatch: AugCandidate[] = [];
    let cumulativeCost = 0;
    let currentMultiplier = 1.0;
    const selectedNames = new Set<string>();
    const skippedNames = new Set<string>();

    while (selectedBatch.length < baseTargetBatch) {
      const nextCandidate = sortedByPriceAsc.find((candidate) => {
        if (selectedNames.has(candidate.name) || skippedNames.has(candidate.name)) {
          return false;
        }
        const prereqs = sing.getAugmentationPrereq(candidate.name);
        return prereqs.every(
          (prereq) => ownedAugs.includes(prereq) || selectedNames.has(prereq),
        );
      });

      if (!nextCandidate) break;

      const stepCost = nextCandidate.price * currentMultiplier;
      if (cumulativeCost + stepCost <= currentMoney) {
        selectedBatch.push(nextCandidate);
        selectedNames.add(nextCandidate.name);
        cumulativeCost += stepCost;
        currentMultiplier *= AUG_PRICE_MULT;
      } else {
        skippedNames.add(nextCandidate.name);
      }
    }

    if (selectedBatch.length === 0) return requests;

    const affordableBatch = selectedBatch;

    // Kriterien für CRITICAL Evaluierung
    const isFullBatchReady = affordableBatch.length >= baseTargetBatch;
    const isAllRemainingAugs = affordableBatch.length === candidates.length;
    
    // Priorität bestimmen
    let priority = PurchasePriority.HIGH;
    let isCritical = false;

    if (isFullBatchReady || isAllRemainingAugs) {
      priority = PurchasePriority.CRITICAL; // ⚡ CRITICAL: Das angesparte Batch ist jetzt komplett kaufbar!
      isCritical = true;
    } else {
      priority = adjustPriorityByMult(PurchasePriority.HIGH, efficiencyMult);
    }

    requests.push({
      id: getAugBatchRequestId(affordableBatch),
      category: "PLAYER_AUG",
      priority,
      score: isCritical ? 100 : Math.max(1, Math.floor(85 * efficiencyMult)),
      cost: cumulativeCost,
      description: `${isCritical ? "CRITICAL " : ""}Aug Batch (${affordableBatch.length}/${baseTargetBatch} Items, Total: $${ns.format.number(cumulativeCost)})`,
      action: {
        script: PATHS.app.actions.singularity,
        args: [
          "player-purchase-aug-batch",
          JSON.stringify(
            affordableBatch.map((a) => ({
              faction: a.faction,
              name: a.name,
            }))
          ),
          cumulativeCost,
        ],
      },
    });

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, PlayerEvaluator);
}