import { NS, FactionName } from "@ns";
import { getPurchasedUninstalledAugs } from "../../strategy/player.js";
import { ALL_KNOWN_FACTIONS } from "/shared/constants/factions.js";
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
import {
  AugPurchasePlan,
  AugPurchasePlanItem,
} from "/shared/types/factions.js";
import {
  loadAugmentState,
  patchAugmentState,
} from "/infrastructure/state/state.js";

interface ReadyAugCandidate extends AugPurchasePlanItem {
  faction: FactionName;
  price: number;
}

function getAugBatchRequestId(
  batch: Pick<ReadyAugCandidate, "faction" | "name">[],
): string {
  return `player-aug-batch-${hashString(JSON.stringify(batch))}`;
}

function sameNames(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((name, index) => name === right[index])
  );
}

function isValidPurchasePlan(
  value: AugPurchasePlan | undefined,
  installedAugs: string[],
): value is AugPurchasePlan {
  return (
    !!value &&
    Array.isArray(value.installedAugs) &&
    sameNames(
      [...value.installedAugs].sort(),
      [...installedAugs].sort(),
    ) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        typeof item?.name === "string" &&
        Number.isFinite(item.repReq) &&
        Number.isFinite(item.basePrice) &&
        Array.isArray(item.prereqs) &&
        Array.isArray(item.factions),
    )
  );
}

function buildPurchasePlan(ns: NS, installedAugs: string[]): AugPurchasePlan {
  const sing = ns.singularity;
  const ownedAugs = sing.getOwnedAugmentations(true);
  const itemsByName = new Map<string, AugPurchasePlanItem>();
  let successfulFactionReads = 0;

  for (const faction of ALL_KNOWN_FACTIONS) {
    try {
      const augmentations = sing.getAugmentationsFromFaction(faction);
      successfulFactionReads++;
      for (const name of augmentations) {
        if (name === "NeuroFlux Governor" || ownedAugs.includes(name)) continue;

        const basePrice = sing.getAugmentationPrice(name);
        if (!Number.isFinite(basePrice) || basePrice <= 0) continue;

        const existing = itemsByName.get(name);
        if (existing) {
          if (!existing.factions.includes(faction)) existing.factions.push(faction);
          continue;
        }

        itemsByName.set(name, {
          name,
          repReq: sing.getAugmentationRepReq(name),
          basePrice,
          prereqs: sing.getAugmentationPrereq(name),
          factions: [faction],
        });
      }
    } catch {
      // Unavailable factions are omitted; other faction catalogs remain usable.
    }
  }

  if (successfulFactionReads === 0) {
    throw new Error("Katalog keiner Fraktion konnte gelesen werden.");
  }

  const remaining = new Map(itemsByName);
  const orderedItems: AugPurchasePlanItem[] = [];
  const orderedNames = new Set(ownedAugs);

  while (remaining.size > 0) {
    const readyItems = Array.from(remaining.values())
      .filter((item) => item.prereqs.every((prereq) => orderedNames.has(prereq)))
      .sort(
        (a, b) =>
          b.basePrice - a.basePrice || a.name.localeCompare(b.name),
      );
    const next = readyItems[0] ?? Array.from(remaining.values()).sort(
      (a, b) => a.name.localeCompare(b.name),
    )[0];
    orderedItems.push(next);
    orderedNames.add(next.name);
    remaining.delete(next.name);
  }

  return {
    createdAt: Date.now(),
    installedAugs: [...installedAugs].sort(),
    items: orderedItems,
  };
}

async function ensureAugPurchasePlan(ns: NS): Promise<void> {
  if (!hasSingularity(ns) || getPurchasedUninstalledAugs(ns).length > 0) return;

  const installedAugs = ns.singularity.getOwnedAugmentations(false);
  const existingPlan = loadAugmentState(ns)?.augPurchasePlan;
  if (isValidPurchasePlan(existingPlan, installedAugs)) return;

  try {
    const plan = buildPurchasePlan(ns, installedAugs);
    await patchAugmentState(ns, { augPurchasePlan: plan });
    ns.print(
      `[AUG] Fester Kaufplan erstellt: ${plan.items.length} Augmentierungen.`,
    );
  } catch (error) {
    ns.print(`[AUG] Kaufplan konnte nicht erstellt werden: ${error}`);
  }
}

function getAvailableFaction(
  ns: NS,
  item: AugPurchasePlanItem,
  factions: Set<FactionName>,
): FactionName | null {
  const eligibleFactions = item.factions
    .filter((faction) => factions.has(faction))
    .map((faction) => ({
      faction,
      rep: ns.singularity.getFactionRep(faction),
    }))
    .filter(({ rep }) => rep >= item.repReq)
    .sort((a, b) => b.rep - a.rep || a.faction.localeCompare(b.faction));

  return eligibleFactions[0]?.faction ?? null;
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

    // Installing augmentations resets the game; the player performs that step manually.
    if (uninstalled.length > 0) return requests;

    const plan = loadAugmentState(ns)?.augPurchasePlan;
    if (!isValidPurchasePlan(plan, sing.getOwnedAugmentations(false))) {
      return requests;
    }

    const playerFactions = new Set<FactionName>(ns.getPlayer().factions);
    try {
      if (ns.gang?.inGang()) {
        playerFactions.add(
          ns.gang.getGangInformation().faction as FactionName,
        );
      }
    } catch {
      // The player faction list remains sufficient if the gang API is unavailable.
    }

    const availableCandidates: ReadyAugCandidate[] = [];
    const availableNames = new Set(ownedAugs);
    for (const item of plan.items) {
      if (ownedAugs.includes(item.name)) continue;
      const faction = getAvailableFaction(ns, item, playerFactions);
      if (!faction) continue;
      const price = sing.getAugmentationPrice(item.name);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (!item.prereqs.every((prereq) => availableNames.has(prereq))) continue;

      availableCandidates.push({ ...item, faction, price });
      availableNames.add(item.name);
    }

    if (availableCandidates.length === 0) return requests;

    // The Red Pill stays an explicit exception to the normal purchase batch.
    const redPill = availableCandidates.find(
      (item) =>
        item.name === "The Red Pill" &&
        item.prereqs.every((prereq) => ownedAugs.includes(prereq)),
    );
    if (redPill && redPill.price <= currentMoney) {
      requests.push({
        id: "player-aug-redpill",
        category: "PLAYER_AUG",
        priority: PurchasePriority.CRITICAL, // ⚡ CRITICAL: Win-Condition
        score: 100,
        cost: redPill.price,
        description: "CRITICAL: The Red Pill Purchase",
        action: {
          script: PATHS.app.actions.singularity,
          args: [
            "player-purchase-aug",
            redPill.faction,
            redPill.name,
            redPill.price,
          ],
        },
      });
      return requests;
    }

    const baseTargetBatch = Math.max(3, Math.min(8, Math.floor(6 / (costMult || 1))));
    const selectedBatch: ReadyAugCandidate[] = [];
    let cumulativeCost = 0;
    let currentMultiplier = 1.0;
    const selectedNames = new Set<string>();
    for (const candidate of availableCandidates) {
      if (selectedBatch.length >= baseTargetBatch) break;
      if (
        !candidate.prereqs.every(
          (prereq) => ownedAugs.includes(prereq) || selectedNames.has(prereq),
        )
      ) {
        continue;
      }

      const stepCost = candidate.price * currentMultiplier;
      if (cumulativeCost + stepCost > currentMoney) continue;

      selectedBatch.push(candidate);
      selectedNames.add(candidate.name);
      cumulativeCost += stepCost;
      currentMultiplier *= AUG_PRICE_MULT;
    }

    if (selectedBatch.length === 0) return requests;

    const isFullBatchReady = selectedBatch.length >= baseTargetBatch;
    const isAllRemainingAugs =
      selectedBatch.length === availableCandidates.length;
    
    let priority = PurchasePriority.HIGH;
    let isCritical = false;

    if (isFullBatchReady || isAllRemainingAugs) {
      priority = PurchasePriority.CRITICAL;
      isCritical = true;
    } else {
      priority = adjustPriorityByMult(PurchasePriority.HIGH, efficiencyMult);
    }

    requests.push({
      id: getAugBatchRequestId(selectedBatch),
      category: "PLAYER_AUG",
      priority,
      score: isCritical ? 100 : Math.max(1, Math.floor(85 * efficiencyMult)),
      cost: cumulativeCost,
      description: `${isCritical ? "CRITICAL " : ""}Aug Batch (${selectedBatch.length}/${baseTargetBatch} Items, Total: $${ns.format.number(cumulativeCost)})`,
      action: {
        script: PATHS.app.actions.singularity,
        args: [
          "player-purchase-aug-batch",
          JSON.stringify(
            selectedBatch.map((a) => ({
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
  await ensureAugPurchasePlan(ns);
  await runEvaluator(ns, PlayerEvaluator);
}