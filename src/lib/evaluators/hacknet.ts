import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
} from "/lib/types/finance.js";
import { runEvaluator } from "/lib/evaluator-runner.js";
import { loadBnMults, adjustPriorityByMult } from "../utils.js";

interface HacknetRequest extends PurchaseRequest {
  roi: number;
}

const HASH_TO_MONEY_VALUE = 250_000;
const MAX_PAYBACK_TIME_SECONDS = 7200; // 2 Stunden (Hard Cutoff für Cash-ROI)
const MIN_ROI = 1 / MAX_PAYBACK_TIME_SECONDS;

/**
 * Ermittelt die Priorität dynamisch anhand der Amortisationszeit und des RAM-Bedarfs.
 */
function getPriorityFromRoi(
  roi: number,
  isServerMode: boolean,
  ramGainGb = 0,
  totalRamGb = 0,
): PurchasePriority {
  // 🚀 RAM-NOTSTAND: Wenn wir im Server-Modus sind und wenig RAM haben (< 1TB),
  // push RAM-Upgrades und neue Server massiv nach oben!
  if (isServerMode && ramGainGb > 0 && totalRamGb < 1024) {
    if (totalRamGb < 256) return PurchasePriority.CRITICAL;
    return PurchasePriority.HIGH;
  }

  if (roi <= 0 && ramGainGb === 0) return PurchasePriority.IDLE;

  const paybackSeconds = roi > 0 ? 1 / roi : Infinity;

  const highThreshold = isServerMode ? 900 : 300; // 15 Min (Server) / 5 Min (Node)
  const mediumThreshold = isServerMode ? 3600 : 1800; // 60 Min (Server) / 30 Min (Node)

  if (paybackSeconds < 120) return PurchasePriority.CRITICAL;
  if (paybackSeconds < highThreshold) return PurchasePriority.HIGH;
  if (paybackSeconds < mediumThreshold) return PurchasePriority.MEDIUM;

  return PurchasePriority.LOW;
}

function getEstimatedMoneyGain(
  ns: NS,
  level: number,
  ram: number,
  cores: number,
  mult: number,
  isServerMode: boolean,
  hasFormulas: boolean,
): number {
  if (isServerMode) {
    let hashRate = 0;
    if (hasFormulas && ns.formulas?.hacknetServers) {
      hashRate = ns.formulas.hacknetServers.hashGainRate(
        level,
        0,
        ram,
        cores,
        mult,
      );
    } else {
      hashRate =
        0.25 *
        level *
        Math.pow(1.6, Math.log2(ram)) *
        (1 + (cores - 1) * 0.2) *
        mult;
    }
    return hashRate * HASH_TO_MONEY_VALUE;
  } else {
    if (hasFormulas && ns.formulas?.hacknetNodes) {
      return ns.formulas.hacknetNodes.moneyGainRate(level, ram, cores, mult);
    }
    return (
      1.5 *
      level *
      Math.pow(1.5, Math.log2(ram)) *
      (1 + (cores - 1) * 0.2) *
      mult
    );
  }
}

export const HacknetEvaluator: PurchaseEvaluator = {
  category: "HACKNET",

  getRequests(ns: NS): PurchaseRequest[] {
    const isServerMode = typeof (ns.hacknet as any).hashCapacity === "function";
    const bnMults = loadBnMults(ns);

    const hacknetMoneyMult = bnMults.HacknetNodeMoney ?? 1.0;
    if (hacknetMoneyMult <= 0) return [];

    const requests: HacknetRequest[] = [];
    const numNodes = ns.hacknet.numNodes();
    const maxNodes = ns.hacknet.maxNumNodes();
    const hasFormulas = ns.fileExists("Formulas.exe", "home");
    const hNetMults = ns.getHacknetMultipliers();
    const prodMult = hNetMults?.production ?? 1;

    // Gesamt-RAM des Hacknet-Netzwerks berechnen
    let totalHacknetRam = 0;
    for (let i = 0; i < numNodes; i++) {
      totalHacknetRam += ns.hacknet.getNodeStats(i).ram;
    }

    const calculateRoi = (
      cost: number,
      currentGain: number,
      nextGain: number,
    ): number => {
      if (cost <= 0 || !Number.isFinite(cost)) return 0;
      const deltaGain = nextGain - currentGain;
      return deltaGain > 0 ? deltaGain / cost : 0;
    };

    const normalizeRoiToScore = (roi: number, ramGainGb = 0) => {
      let baseScore = Math.floor(roi * 10000 * hacknetMoneyMult);

      // Im Server-Modus belohnen wir RAM-Zuwachs zusätzlich im Score
      if (isServerMode && ramGainGb > 0) {
        baseScore += ramGainGb * 5;
      }

      return Math.min(100, Math.max(1, baseScore));
    };

    // 🟢 1. NEUEN SERVER / NODE KAUFEN (Priorisiert im Server-Modus)
    if (numNodes < maxNodes) {
      const newNodeCost = ns.hacknet.getPurchaseNodeCost();
      if (newNodeCost > 0 && Number.isFinite(newNodeCost)) {
        const newNodeGain = getEstimatedMoneyGain(
          ns,
          1,
          1,
          1,
          prodMult,
          isServerMode,
          hasFormulas,
        );
        const roi = calculateRoi(newNodeCost, 0, newNodeGain);

        // Neue Server geben 1GB Basis-RAM + neuen Ausbau-Slot
        const basePriority = getPriorityFromRoi(
          roi,
          isServerMode,
          1,
          totalHacknetRam,
        );
        const priority = adjustPriorityByMult(basePriority, hacknetMoneyMult);

        requests.push({
          id: `hacknet-new-node-${numNodes}`,
          category: "HACKNET",
          priority,
          score: normalizeRoiToScore(roi, 1),
          cost: newNodeCost,
          roi,
          description: `Hacknet ${isServerMode ? "Server" : "Node"} #${numNodes + 1} kaufen`,
          action: {
            script: "core/actions/act-hacknet.js",
            args: ["hacknet-new-node", numNodes],
          },
        });
      }
    }

    // 🟢 2. EXISTIERENDE NODES UPGRADEN
    for (let i = 0; i < numNodes; i++) {
      const stats = ns.hacknet.getNodeStats(i);
      const currentGain = isServerMode
        ? stats.production * HASH_TO_MONEY_VALUE
        : stats.production;

      const upgradeCandidates = [
        {
          type: "level",
          cost: ns.hacknet.getLevelUpgradeCost(i, 1),
          ramGain: 0,
          nextGain: getEstimatedMoneyGain(
            ns,
            stats.level + 1,
            stats.ram,
            stats.cores,
            prodMult,
            isServerMode,
            hasFormulas,
          ),
          desc: `Level (${stats.level} ➔ ${stats.level + 1})`,
          actArg: "hacknet-upgrade-level",
        },
        {
          type: "ram",
          cost: ns.hacknet.getRamUpgradeCost(i, 1),
          ramGain: stats.ram, // Verdopplung des RAMs = Zuwachs um den aktuellen Wert
          nextGain: getEstimatedMoneyGain(
            ns,
            stats.level,
            stats.ram * 2,
            stats.cores,
            prodMult,
            isServerMode,
            hasFormulas,
          ),
          desc: `RAM (${stats.ram}GB ➔ ${stats.ram * 2}GB)`,
          actArg: "hacknet-upgrade-ram",
        },
        {
          type: "core",
          cost: ns.hacknet.getCoreUpgradeCost(i, 1),
          ramGain: 0,
          nextGain: getEstimatedMoneyGain(
            ns,
            stats.level,
            stats.ram,
            stats.cores + 1,
            prodMult,
            isServerMode,
            hasFormulas,
          ),
          desc: `Core (${stats.cores} ➔ ${stats.cores + 1})`,
          actArg: "hacknet-upgrade-core",
        },
      ];

      // Cache Upgrades (nur im Server-Modus relevant)
      if (isServerMode && "cache" in stats) {
        const cacheCost = ns.hacknet.getCacheUpgradeCost(i, 1);
        if (cacheCost > 0 && Number.isFinite(cacheCost)) {
          const currentCache = (stats as any).cache ?? 1;
          const cacheRoi =
            currentCache < 10
              ? (currentGain * 0.15) / cacheCost
              : (currentGain * 0.02) / cacheCost;

          const baseCachePriority = getPriorityFromRoi(
            cacheRoi,
            isServerMode,
            0,
            totalHacknetRam,
          );
          const cachePriority = adjustPriorityByMult(
            baseCachePriority,
            hacknetMoneyMult,
          );

          requests.push({
            id: `hacknet-node-${i}-cache`,
            category: "HACKNET",
            priority: cachePriority,
            score: normalizeRoiToScore(cacheRoi),
            cost: cacheCost,
            roi: cacheRoi,
            description: `Hacknet Server #${i + 1} Cache (${currentCache} ➔ ${currentCache + 1})`,
            action: {
              script: "core/actions/act-hacknet.js",
              args: ["hacknet-upgrade-cache", i, 1],
            },
          });
        }
      }

      for (const upg of upgradeCandidates) {
        if (upg.cost > 0 && Number.isFinite(upg.cost)) {
          const roi = calculateRoi(upg.cost, currentGain, upg.nextGain);

          // RAM-Gewinn fließt direkt in die Prioritätsbewertung ein
          const basePriority = getPriorityFromRoi(
            roi,
            isServerMode,
            upg.ramGain,
            totalHacknetRam,
          );
          const priority = adjustPriorityByMult(basePriority, hacknetMoneyMult);

          requests.push({
            id: `hacknet-node-${i}-${upg.type}`,
            category: "HACKNET",
            priority,
            score: normalizeRoiToScore(roi, upg.ramGain),
            cost: upg.cost,
            roi,
            description: `Hacknet ${isServerMode ? "Server" : "Node"} #${i + 1} ${upg.desc}`,
            action: {
              script: "core/actions/act-hacknet.js",
              args: [upg.actArg, i, 1],
            },
          });
        }
      }
    }

    return requests
      .filter((req) => {
        // Im Server-Modus lassen wir RAM-Upgrades & neue Server auch zu, wenn deren Cash-ROI unter MIN_ROI liegt
        if (isServerMode && req.id.includes("-ram")) return true;
        if (isServerMode && req.id.startsWith("hacknet-new-node")) return true;
        return req.roi >= MIN_ROI && req.score !== undefined && req.score > 0;
      })
      .sort((a, b) => {
        // 1. Sortierung nach Priorität (CRITICAL = 1 ist dringender als LOW = 4)
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }

        // 2. Tie-Breaker: Höherer Score gewinnt (Fall-Back auf 0 für TS-Safety)
        return (b.score ?? 0) - (a.score ?? 0);
      });
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, HacknetEvaluator);
}
