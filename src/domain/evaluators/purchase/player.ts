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
import { CASH_BUFFER } from "/shared/constants/finance.js";
import { loadFinanceState } from "/infrastructure/state/state.js";
import { runEvaluator } from "../evaluator-runner.js";
import { AUG_PRICE_MULT } from "../../../shared/constants/game-defaults";
import { PATHS } from "/infrastructure/runtime/paths.js";
import {
  getBestNeuroFluxTarget,
  shouldPerformReset,
} from "../../player/neuroflux.js";

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
  const batchData = JSON.stringify(batch);
  let hash = 2166136261;
  for (let i = 0; i < batchData.length; i++) {
    hash ^= batchData.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `player-aug-batch-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function getFavorTarget(
  ns: NS,
  ownedAugs: string[],
  availableMoney: number,
): { faction: FactionName; augName: string; donation: number } | null {
  const sing = ns.singularity;
  const formulas = ns.formulas?.reputation;
  if (!formulas) return null;

  const player = ns.getPlayer();
  const minFavor = ns.getFavorToDonate();
  let gangFaction: string | null = null;
  try {
    if (ns.gang?.inGang()) {
      gangFaction = ns.gang.getGangInformation().faction;
    }
  } catch {
    gangFaction = null;
  }

  const eligibleFactions = new Set<FactionName>(player.factions);
  let bestTarget: {
    faction: FactionName;
    augName: string;
    donation: number;
  } | null = null;

  for (const faction of eligibleFactions) {
    if (
      faction === gangFaction ||
      sing.getFactionFavor(faction) < minFavor ||
      sing.getFactionWorkTypes(faction).length === 0
    ) {
      continue;
    }

    const factionRep = sing.getFactionRep(faction);
    for (const augName of sing.getAugmentationsFromFaction(faction)) {
      if (
        augName === "NeuroFlux Governor" ||
        ownedAugs.includes(augName) ||
        !sing.getAugmentationPrereq(augName).every((prereq) =>
          ownedAugs.includes(prereq),
        )
      ) {
        continue;
      }

      const repGap = sing.getAugmentationRepReq(augName) - factionRep;
      if (repGap <= 0) continue;

      const donation = Math.ceil(
        formulas.donationForRep(repGap, player) * 1.01,
      );
      const augPrice = sing.getAugmentationPrice(augName);
      if (
        !Number.isFinite(donation) ||
        donation <= 0 ||
        !Number.isFinite(augPrice) ||
        donation + augPrice > availableMoney
      ) {
        continue;
      }

      if (!bestTarget || donation < bestTarget.donation) {
        bestTarget = { faction, augName, donation };
      }
    }
  }

  return bestTarget;
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
    const gangFaction = ns.gang?.inGang()
      ? (ns.gang.getGangInformation().faction as FactionName)
      : null;

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

    // --- FALL 1: BEREITS IM KAUFMODUS (DUMP MODE) ---
    if (hasStartedBuying) {
      if (shouldPerformReset(ns)) {
        requests.push({
          id: "player-install-augs",
          category: "PLAYER_AUG",
          priority: PurchasePriority.CRITICAL,
          score: 100,
          cost: 0,
          description: `Installiere Augmentations (${uninstalled.length} bereit)`,
          action: {
            script: PATHS.app.actions.singularity,
            args: ["player-install-augs", "init.js"],
          },
        });
        return requests;
      }

      const immediateBuyable = candidates
        .filter(
          (aug) =>
            sing.getAugmentationPrereq(aug.name).every((p) => ownedAugs.includes(p)) &&
            aug.price <= currentMoney
        )
        .sort((a, b) => {
          if (a.name === "The Red Pill") return -1;
          if (b.name === "The Red Pill") return 1;
          return b.price - a.price;
        });

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
            args: [
              "player-purchase-aug",
              nextTarget.faction,
              nextTarget.name,
              nextTarget.price,
            ],
          },
        });
        return requests;
      }

      const configuredReserve = loadFinanceState(ns)?.moneyReserve ?? 0;
      const availableForFavor = Math.max(
        0,
        currentMoney - Math.max(CASH_BUFFER, configuredReserve),
      );
      const favorTarget = getFavorTarget(
        ns,
        ownedAugs,
        availableForFavor,
      );
      if (favorTarget) {
        requests.push({
          id: `player-faction-favor-${favorTarget.faction}-${favorTarget.augName}`,
          category: "PLAYER_AUG",
          priority: PurchasePriority.CRITICAL,
          score: 98,
          cost: favorTarget.donation,
          description: `Faction-Favor für ${favorTarget.augName} bei ${favorTarget.faction}`,
          action: {
            script: PATHS.app.actions.singularity,
            args: [
              "player-donate-faction",
              favorTarget.faction,
              favorTarget.donation,
            ],
          },
        });
        return requests;
      }

      // Restgeld in NeuroFlux kippen
      const nfgTarget = getBestNeuroFluxTarget(ns);
      if (nfgTarget && currentMoney >= nfgTarget.price) {
        requests.push({
          id: `player-aug-nfg-${nfgTarget.faction}`,
          category: "PLAYER_AUG",
          priority: PurchasePriority.CRITICAL, // ⚡ CRITICAL: Letztes Geld vor Reset sichern
          score: 99,
          cost: nfgTarget.price,
          description: `[CRITICAL DUMP] NeuroFlux Governor via ${nfgTarget.faction}`,
          action: {
            script: PATHS.app.actions.singularity,
            args: ["player-purchase-nfg", nfgTarget.faction, nfgTarget.price],
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

    // --- FALL 3: BATCH-EVALUIERUNG UND CRITICAL-PROMOTION ---
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