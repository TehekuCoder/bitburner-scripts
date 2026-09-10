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
    const hasStartedBuying = uninstalled.length > 0;
    const currentMoney = ns.getServerMoneyAvailable("home");

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
        if (aug === "NeuroFlux Governor" || ownedAugs.includes(aug) || scannedAugNames.has(aug)) {
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
              isGang: false,
              etaSeconds: 0,
            });
            scannedAugNames.add(aug);
          }
        }
      }
    }

    // --- FALL 1: BEREITS IM KAUFMODUS (DUMP MODE) ---
    // Sobald das erste Augment gekauft wurde, haben alle Folgekäufe CRITICAL Status
    if (hasStartedBuying) {
      const immediateBuyable = candidates
        .filter(
          (aug) =>
            sing.getAugmentationPrereq(aug.name).every((p) => ownedAugs.includes(p)) &&
            aug.price <= currentMoney
        )
        .sort((a, b) => b.price - a.price);

      if (immediateBuyable.length > 0) {
        const nextTarget = immediateBuyable[0];
        requests.push({
          id: `player-aug-dump-${nextTarget.name}`,
          category: "PLAYER_AUG",
          priority: PurchasePriority.CRITICAL, // ⚡ CRITICAL: Kaufserie vollenden
          score: 100,
          cost: nextTarget.price,
          description: `[CRITICAL DUMP] ${nextTarget.name}`,
          action: {
            script: PATHS.app.actions.singularity,
            args: ["player-purchase-aug", nextTarget.faction, nextTarget.name],
          },
        });
        return requests;
      }

      // Restgeld in NeuroFlux kippen
      const nfgTarget = getBestNeuroFluxTarget(ns);
      if (nfgTarget && currentMoney >= nfgTarget.price) {
        requests.push({
          id: `player-aug-nfg-${Date.now()}`,
          category: "PLAYER_AUG",
          priority: PurchasePriority.CRITICAL, // ⚡ CRITICAL: Letztes Geld vor Reset sichern
          score: 99,
          cost: nfgTarget.price,
          description: `[CRITICAL DUMP] NeuroFlux Governor via ${nfgTarget.faction}`,
          action: {
            script: PATHS.app.actions.singularity,
            args: ["player-purchase-nfg", nfgTarget.faction],
          },
        });
        return requests;
      }
      return requests;
    }

    if (candidates.length === 0) return requests;

    // --- FALL 2: RED PILL CHECK ---
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
          args: ["player-purchase-aug", redPillCand.faction, redPillCand.name],
        },
      });
      return requests;
    }

    // --- FALL 3: BATCH-EVALUIERUNG UND CRITICAL-PROMOTION ---
    const baseTargetBatch = Math.max(3, Math.min(8, Math.floor(6 / (costMult || 1))));
    const sortedByPriceAsc = [...candidates].sort((a, b) => a.price - b.price);

    const selectedBatch: AugCandidate[] = [];
    let cumulativeCost = 0;
    let currentMultiplier = 1.0;

    for (const cand of sortedByPriceAsc) {
      const prereqs = sing.getAugmentationPrereq(cand.name).filter((p) => !ownedAugs.includes(p));
      const missingPrereqs = prereqs.filter((p) => !selectedBatch.some((b) => b.name === p));

      if (missingPrereqs.length > 0) continue;

      const stepCost = cand.price * currentMultiplier;
      
      // Prüfen, ob das Batch bezahlbar bleibt
      if (cumulativeCost + stepCost <= currentMoney) {
        selectedBatch.push(cand);
        cumulativeCost += stepCost;
        currentMultiplier *= AUG_PRICE_MULT;
      }

      if (selectedBatch.length >= baseTargetBatch) break;
    }

    if (selectedBatch.length === 0) return requests;

    // Sortierung für Ausführung: Teuerstes zuerst
    const affordableBatch = [...selectedBatch].sort((a, b) => b.price - a.price);

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
      id: "player-aug-batch",
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
        ],
      },
    });

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, PlayerEvaluator);
}