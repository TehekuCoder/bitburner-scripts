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
import { PATHS } from "/infrastructure/runtime/paths.js";
import { hashString } from "/lib/hash.js";
import {
  AugPurchasePlan,
  AugPurchasePlanItem,
} from "/shared/types/factions.js";
import {
  getEligibleAugmentations,
  selectNextAugmentationRequest,
} from "./augmentation-plan.js";
import {
  loadAugmentState,
  patchAugmentState,
} from "/infrastructure/state/state.js";

function getCurrentGangFaction(ns: NS): FactionName | undefined {
  if (!ns.gang?.inGang()) return undefined;
  return ns.gang.getGangInformation().faction;
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
  gangFaction: FactionName | undefined,
): value is AugPurchasePlan {
  return (
    !!value &&
    value.gangFaction === gangFaction &&
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

function buildPurchasePlan(
  ns: NS,
  installedAugs: string[],
  gangFaction: FactionName | undefined,
): AugPurchasePlan {
  const sing = ns.singularity;
  const ownedAugs = sing.getOwnedAugmentations(true);
  const itemsByName = new Map<string, AugPurchasePlanItem>();
  let successfulFactionReads = 0;

  const factionsToScan = new Set(ALL_KNOWN_FACTIONS);
  if (gangFaction) factionsToScan.add(gangFaction);
  for (const faction of factionsToScan) {
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
    gangFaction,
    items: orderedItems,
  };
}

async function ensureAugPurchasePlan(ns: NS): Promise<void> {
  if (!hasSingularity(ns) || getPurchasedUninstalledAugs(ns).length > 0) return;

  const installedAugs = ns.singularity.getOwnedAugmentations(false);
  const gangFaction = getCurrentGangFaction(ns);
  const existingPlan = loadAugmentState(ns)?.augPurchasePlan;
  if (isValidPurchasePlan(existingPlan, installedAugs, gangFaction)) return;

  try {
    const plan = buildPurchasePlan(ns, installedAugs, gangFaction);
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
      favor: ns.singularity.getFactionFavor(faction),
    }))
    .filter(({ rep }) => rep >= item.repReq)
    .sort(
      (a, b) =>
        b.favor - a.favor || b.rep - a.rep || a.faction.localeCompare(b.faction),
    );

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

    // Installing augmentations resets the game; the player performs that step manually.
    if (uninstalled.length > 0) return requests;

    const plan = loadAugmentState(ns)?.augPurchasePlan;
    const gangFaction = getCurrentGangFaction(ns);
    if (
      !isValidPurchasePlan(
        plan,
        sing.getOwnedAugmentations(false),
        gangFaction,
      )
    ) {
      return requests;
    }

    const playerFactions = new Set<FactionName>(ns.getPlayer().factions);
    if (gangFaction) playerFactions.add(gangFaction);

    const ownedAugSet = new Set(ownedAugs);
    const eligibleItems = getEligibleAugmentations(plan.items, ownedAugSet);
    for (const item of eligibleItems) {
      const faction = getAvailableFaction(ns, item, playerFactions);
      if (!faction) continue;

      const price = sing.getAugmentationPrice(item.name);
      if (!Number.isFinite(price) || price <= 0) continue;
      const isRedPill = item.name === "The Red Pill";

      requests.push({
        id: `player-aug-${hashString(
          JSON.stringify([faction, item.name, price]),
        )}`,
        category: "PLAYER_AUG",
        priority: isRedPill
          ? PurchasePriority.CRITICAL
          : adjustPriorityByMult(PurchasePriority.HIGH, efficiencyMult),
        score: isRedPill ? 100 : price,
        cost: price,
        description: `${isRedPill ? "CRITICAL " : ""}Augmentation: ${item.name} (${faction})`,
        action: {
          script: PATHS.app.actions.singularity,
          args: ["player-purchase-aug", faction, item.name, price],
        },
      });
    }

    const nextRequest = selectNextAugmentationRequest(requests);
    return nextRequest ? [nextRequest] : [];
  },
};

export async function main(ns: NS): Promise<void> {
  await ensureAugPurchasePlan(ns);
  await runEvaluator(ns, PlayerEvaluator);
}