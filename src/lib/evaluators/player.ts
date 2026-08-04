// lib/evaluators/player.ts
import { NS, FactionName } from "@ns";
import { getPurchasedUninstalledAugs } from "/lib/player.js";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
} from "/lib/types/finance.js";
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

/**
 * Sortiert Augmentations streng nach Prerequisites (Abhängigkeiten) und danach
 * absteigend nach Preis (teuerste zuerst), um den 1.9x-Multiplikator zu minimieren.
 */
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

    if (validNext.length === 0) break; // Schutz vor unerfüllbaren Prerequisites

    validNext.sort((a, b) => b.price - a.price);
    const chosen = validNext[0];

    result.push(chosen);
    const idx = remaining.findIndex((r) => r.name === chosen.name);
    if (idx !== -1) remaining.splice(idx, 1);
  }

  return result;
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
        if (
          aug === "NeuroFlux Governor" ||
          ownedAugs.includes(aug) ||
          scannedAugNames.has(aug)
        )
          continue;

        const repReq = sing.getAugmentationRepReq(aug);
        let etaSeconds = 0;

        if (currentRep < repReq) {
          if (isGang && gangRepPerSec > 0) {
            etaSeconds = (repReq - currentRep) / gangRepPerSec;
          } else {
            continue;
          }
        }

        // Augments berücksichtigen, die sofort oder in max. 180s freigeschaltet sind
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

    // Nur Augments wählen, deren Ruf JETZT schon ausreicht (ETA = 0)
    const readyCandidates = candidates.filter((item) => item.etaSeconds === 0);
    const currentMoney = ns.getServerMoneyAvailable("home");

    // -------------------------------------------------------------
    // FALL 1: BEREITS IM KAUFMODUS (Uninstalled Augs bereits im Inventar)
    // -------------------------------------------------------------
    if (hasStartedBuying) {
      const immediateBuyable = readyCandidates.filter((aug) =>
        sing.getAugmentationPrereq(aug.name).every((p) => ownedAugs.includes(p))
      );

      if (immediateBuyable.length === 0) return requests;

      immediateBuyable.sort((a, b) => b.price - a.price);
      const nextTarget = immediateBuyable[0];

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

    // -------------------------------------------------------------
    // FALL 2: WARTEN BIS GENUG GELD FÜR 10 AUGMENTS BZW. ALLE RESTLICHEN DA IST
    // -------------------------------------------------------------
    // 1. Die bis zu 10 günstigsten verbleibenden Augmentations auswählen
    const cheapestCandidates = [...readyCandidates]
      .sort((a, b) => a.price - b.price)
      .slice(0, 10);

    // 2. Unter Berücksichtigung von Prerequisites & Preis-Abstieg sortieren
    const orderedBatch = sortAugsWithPrereqs(cheapestCandidates, sing, ownedAugs);

    // 3. Exakte Gesamtkosten inkl. 1.9x Multiplikator berechnen
    let totalBatchCost = 0;
    let currentMult = 1.0;
    for (const aug of orderedBatch) {
      totalBatchCost += aug.price * currentMult;
      currentMult *= AUG_PRICE_MULT;
    }

    const hasRedPill = orderedBatch.some((a) => a.name === "The Red Pill");
    const canAffordFullBatch = currentMoney >= totalBatchCost;

    // 4. NUR KAUFEN, wenn das Geld für das GESAMTE Paket reicht (oder Red Pill bereitsteht)
    if (canAffordFullBatch || hasRedPill) {
      requests.push({
        id: "player-aug-batch",
        category: "PLAYER_AUG",
        priority: PurchasePriority.CRITICAL,
        score: 100,
        cost: totalBatchCost,
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