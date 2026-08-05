// lib/evaluators/hacknet.ts
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
const MAX_PAYBACK_TIME_SECONDS = 7200; // 2 Stunden
const MIN_ROI = 1 / MAX_PAYBACK_TIME_SECONDS;

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

    // 🔴 1. HARD CHECK: Falls Hacknet-Ertrag in dieser BitNode 0 ist, abbrechen
    const hacknetMoneyMult = bnMults.HacknetNodeMoney ?? 1.0;
    if (hacknetMoneyMult <= 0) return [];

    const requests: HacknetRequest[] = [];
    const numNodes = ns.hacknet.numNodes();
    const maxNodes = ns.hacknet.maxNumNodes();
    const hasFormulas = ns.fileExists("Formulas.exe", "home");
    const hNetMults = ns.getHacknetMultipliers();
    const prodMult = hNetMults?.production ?? 1;

    const calculateRoi = (
      cost: number,
      currentGain: number,
      nextGain: number,
    ): number => {
      if (cost <= 0 || !Number.isFinite(cost)) return 0;
      const deltaGain = nextGain - currentGain;
      return deltaGain > 0 ? deltaGain / cost : 0;
    };

    const normalizeRoiToScore = (roi: number) => {
      if (roi < MIN_ROI) return 0;
      // Berücksichtigt den BitNode-Multiplikator direkt im Score
      return Math.min(100, Math.max(1, Math.floor(roi * 10000 * hacknetMoneyMult)));
    };

    // 🟢 2. NEUEN NODE KAUFEN (Priorität wird über bnMults angepasst)
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

        // Basis-Priorität festlegen
        let basePriority = PurchasePriority.LOW;
        if (numNodes === 0) basePriority = PurchasePriority.HIGH;
        else if (numNodes < 4) basePriority = PurchasePriority.MEDIUM;

        // Dynamische Dämpfung durch BitNode Multiplikator
        const priority = adjustPriorityByMult(basePriority, hacknetMoneyMult);

        requests.push({
          id: `hacknet-new-node-${numNodes}`,
          category: "HACKNET",
          priority,
          score: normalizeRoiToScore(roi),
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

    // 🟢 3. EXISTIERENDE NODES UPGRADEN
    for (let i = 0; i < numNodes; i++) {
      const stats = ns.hacknet.getNodeStats(i);
      const currentGain = isServerMode
        ? stats.production * HASH_TO_MONEY_VALUE
        : stats.production;

      let baseUpgradePriority = numNodes < 4 ? PurchasePriority.MEDIUM : PurchasePriority.LOW;
      const upgradePriority = adjustPriorityByMult(baseUpgradePriority, hacknetMoneyMult);

      const upgradeCandidates = [
        {
          type: "level",
          cost: ns.hacknet.getLevelUpgradeCost(i, 1),
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

      // Cache Upgrades (Server-Modus)
      if (isServerMode && "cache" in stats) {
        const cacheCost = ns.hacknet.getCacheUpgradeCost(i, 1);
        if (cacheCost > 0 && Number.isFinite(cacheCost)) {
          const currentCache = (stats as any).cache ?? 1;
          const cacheRoi =
            currentCache < 10
              ? (currentGain * 0.15) / cacheCost
              : (currentGain * 0.02) / cacheCost;

          requests.push({
            id: `hacknet-node-${i}-cache`,
            category: "HACKNET",
            priority: upgradePriority,
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

          requests.push({
            id: `hacknet-node-${i}-${upg.type}`,
            category: "HACKNET",
            priority: upgradePriority,
            score: normalizeRoiToScore(roi),
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
      .filter(
        (req) => req.roi >= MIN_ROI && req.score !== undefined && req.score > 0,
      )
      .sort((a, b) => b.roi - a.roi);
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, HacknetEvaluator);
}