// lib/evaluators/hacknet.ts
import { NS } from "@ns";
import { PurchaseEvaluator, PurchaseRequest, PurchasePriority } from "/lib/types/finance.js";
import { runEvaluator } from "/lib/evaluator-runner.js";
import { loadBnMults } from "../utils";

interface HacknetRequest extends PurchaseRequest {
  roi: number;
}

export const HacknetEvaluator: PurchaseEvaluator = {
  category: "HACKNET",

  getRequests(ns: NS): PurchaseRequest[] {
    const bnMults = loadBnMults(ns);
    if (bnMults.HacknetNodeMoney === 0) return [];

    const requests: HacknetRequest[] = [];
    const numNodes = ns.hacknet.numNodes();
    const hasFormulas = ns.fileExists("Formulas.exe", "home");
    const hNetMults = hasFormulas ? ns.getHacknetMultipliers() : null;

    const calculateRoi = (cost: number, currentGain: number, nextGain: number): number => {
      if (cost <= 0 || !Number.isFinite(cost)) return 0;
      return (hasFormulas && nextGain > currentGain) ? (nextGain - currentGain) / cost : 1 / cost;
    };

    // Helfer für das Mapping von ROI auf den Standard-Score (0-100)
    const normalizeRoiToScore = (roi: number) => Math.min(100, Math.max(1, Math.floor(roi * 10000)));

    const newNodeCost = ns.hacknet.getPurchaseNodeCost();
    if (newNodeCost > 0 && Number.isFinite(newNodeCost)) {
      const newNodeGain = (hasFormulas && hNetMults) 
        ? ns.formulas.hacknetNodes.moneyGainRate(1, 1, 1, hNetMults.production) 
        : 1.5;
      
      const roi = calculateRoi(newNodeCost, 0, newNodeGain);
      requests.push({
        id: `hacknet-new-node-${numNodes}`,
        category: "HACKNET",
        priority: numNodes === 0 ? PurchasePriority.HIGH : (numNodes < 4 ? PurchasePriority.MEDIUM : PurchasePriority.LOW),
        score: normalizeRoiToScore(roi),
        cost: newNodeCost,
        roi,
        description: `Hacknet Node #${numNodes + 1} kaufen`,
        action: {
          script: "core/actions/act-hacknet.js",
          args: ["hacknet-new-node", numNodes],
        },
      });
    }

    for (let i = 0; i < numNodes; i++) {
      const stats = ns.hacknet.getNodeStats(i);
      
      const upgrades = [
        { type: 'level', cost: ns.hacknet.getLevelUpgradeCost(i, 1), action: () => ns.hacknet.upgradeLevel(i, 1), nextGainFn: () => ns.formulas.hacknetNodes.moneyGainRate(stats.level + 1, stats.ram, stats.cores, hNetMults!.production), desc: `Level (${stats.level} ➔ ${stats.level + 1})` },
        { type: 'ram', cost: ns.hacknet.getRamUpgradeCost(i, 1), action: () => ns.hacknet.upgradeRam(i, 1), nextGainFn: () => ns.formulas.hacknetNodes.moneyGainRate(stats.level, stats.ram * 2, stats.cores, hNetMults!.production), desc: `RAM (${stats.ram}GB ➔ ${stats.ram * 2}GB)` },
        { type: 'core', cost: ns.hacknet.getCoreUpgradeCost(i, 1), action: () => ns.hacknet.upgradeCore(i, 1), nextGainFn: () => ns.formulas.hacknetNodes.moneyGainRate(stats.level, stats.ram, stats.cores + 1, hNetMults!.production), desc: `Core (${stats.cores} ➔ ${stats.cores + 1})` }
      ];

      for (const upg of upgrades) {
        if (upg.cost > 0 && Number.isFinite(upg.cost)) {
          const nextGain = (hasFormulas && hNetMults) ? upg.nextGainFn() : 0;
          const roi = calculateRoi(upg.cost, stats.production, nextGain);
          
          requests.push({
            id: `hacknet-node-${i}-${upg.type}`,
            category: "HACKNET",
            priority: numNodes < 4 ? PurchasePriority.MEDIUM : PurchasePriority.LOW,
            score: normalizeRoiToScore(roi),
            cost: upg.cost,
            roi,
            description: `Hacknet Node #${i + 1} ${upg.desc}`,
            action: {
              script: "core/actions/act-hacknet.js",
              args: [
                upg.type === "level"
                  ? "hacknet-upgrade-level"
                  : upg.type === "ram"
                  ? "hacknet-upgrade-ram"
                  : "hacknet-upgrade-core",
                i,
                1,
              ],
            },
          });
        }
      }
    }

    return requests.sort((a, b) => b.roi - a.roi);
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, HacknetEvaluator);
}