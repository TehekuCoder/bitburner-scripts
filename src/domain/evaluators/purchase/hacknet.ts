import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
} from "/shared/types/finance.js";
import { runEvaluator } from "../evaluator-runner.js";
import {
  loadBnMults,
  adjustPriorityByMult,
  hasCorporation,
  hasBladeburner,
} from "lib/utils.js";
import { PATHS } from "/infrastructure/runtime/paths.js";

interface HacknetRequest extends PurchaseRequest {
  roi: number;
}

const HASH_TO_MONEY_VALUE = 250_000;
const MAX_PAYBACK_TIME_SECONDS = 7200; // 2 Stunden (Hard Cutoff für Cash-ROI)
const MIN_ROI = 1 / MAX_PAYBACK_TIME_SECONDS;
const MIN_TARGET_RAM = 16; // 🎯 Mindest-RAM pro Hacknet Server/Node für Skript-Ausführung

function getPriorityFromRoi(
  roi: number,
  isServerMode: boolean,
  ramGainGb = 0,
  totalRamGb = 0,
): PurchasePriority {
  if (isServerMode && ramGainGb > 0 && totalRamGb < 1024) {
    if (totalRamGb < 256) return PurchasePriority.CRITICAL;
    return PurchasePriority.HIGH;
  }

  if (roi <= 0 && ramGainGb === 0) return PurchasePriority.IDLE;

  const paybackSeconds = roi > 0 ? 1 / roi : Infinity;

  const highThreshold = isServerMode ? 900 : 300;
  const mediumThreshold = isServerMode ? 3600 : 1800;

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

function evaluateServerRamUpgrade(
  req: HacknetRequest,
  ns: NS,
  isCapacityBlocked: boolean,
  currentRamGb: number,
): boolean {
  if (currentRamGb < MIN_TARGET_RAM) return true;
  if (isCapacityBlocked) return true;

  const playerMoney = ns.getServerMoneyAvailable("home");
  if (req.cost > playerMoney * 0.05) return false;

  if (req.roi <= 0) return false;

  const paybackTimeSeconds = 1 / req.roi;
  return paybackTimeSeconds <= 3600;
}

export const HacknetEvaluator: PurchaseEvaluator = {
  category: "HACKNET",

  getRequests(ns: NS): PurchaseRequest[] {
    const isServerMode = typeof (ns.hacknet as any).hashCapacity === "function";
    const bnMults = loadBnMults(ns);

    // 🎯 In Bitburner existiert für Hacknet nur HacknetNodeMoney
    const moneyMult = bnMults.HacknetNodeMoney ?? 1.0;

    const numNodes = ns.hacknet.numNodes();
    const player = ns.getPlayer();
    const inNetburners = player.factions.includes("Netburners");

    // Im Standard-Modus abbrechen, wenn Money-Mult 0 ist und Netburners nicht benötigt wird
    if (!isServerMode && moneyMult <= 0 && inNetburners) return [];

    const effectiveMoneyMult = isServerMode
      ? Math.max(moneyMult, 0.5)
      : moneyMult;

    const requests: HacknetRequest[] = [];
    const maxNodes = ns.hacknet.maxNumNodes();
    const hasFormulas = ns.fileExists("Formulas.exe", "home");
    const hNetMults = ns.getHacknetMultipliers();
    const prodMult = hNetMults?.production ?? 1;

    let isCapacityBlocked = false;
    let targetCapNeeded = 0;
    let currentCapacity = 0;
    let fillTimeSeconds = Infinity;

    if (isServerMode) {
      let totalHashRate = 0;
      for (let i = 0; i < numNodes; i++) {
        totalHashRate += ns.hacknet.getNodeStats(i).production;
      }

      currentCapacity = ns.hacknet.hashCapacity();
      fillTimeSeconds =
        totalHashRate > 0 ? currentCapacity / totalHashRate : Infinity;

      targetCapNeeded = 200;
      if (hasCorporation(ns)) targetCapNeeded = Math.max(targetCapNeeded, 300);
      if (hasBladeburner(ns)) targetCapNeeded = Math.max(targetCapNeeded, 500);

      isCapacityBlocked =
        currentCapacity < targetCapNeeded || fillTimeSeconds < 45;
    }

    let totalHacknetRam = 0;
    let totalHacknetLevels = 0;
    let totalHacknetCores = 0;
    let minNodeRam = numNodes > 0 ? Infinity : 0;

    for (let i = 0; i < numNodes; i++) {
      const stats = ns.hacknet.getNodeStats(i);
      totalHacknetRam += stats.ram;
      totalHacknetLevels += stats.level;
      totalHacknetCores += stats.cores;
      minNodeRam = Math.min(minNodeRam, stats.ram);
    }

    const needsNetburnersLevel = !inNetburners && totalHacknetLevels < 100;
    const needsNetburnersRam = !inNetburners && totalHacknetRam < 8;
    const needsNetburnersCores = !inNetburners && totalHacknetCores < 4;

    const calculateRoi = (
      cost: number,
      currentGain: number,
      nextGain: number,
    ): number => {
      if (cost <= 0 || !Number.isFinite(cost)) return 0;
      const deltaGain = nextGain - currentGain;
      return deltaGain > 0 ? deltaGain / cost : 0;
    };

    const normalizeRoiToScore = (
      roi: number,
      effectiveMult: number,
      ramGainGb = 0,
    ) => {
      let baseScore = Math.floor(roi * 10000 * effectiveMult);
      if (isServerMode && ramGainGb > 0) {
        baseScore += ramGainGb * 5;
      }
      return Math.min(100, Math.max(1, baseScore));
    };

    // 🟢 1. NEUEN SERVER / NODE KAUFEN
    const canBuyNewNode = numNodes === 0 || minNodeRam >= MIN_TARGET_RAM;

    if (numNodes < maxNodes && canBuyNewNode) {
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

        let basePriority = getPriorityFromRoi(
          roi,
          isServerMode,
          1,
          totalHacknetRam,
        );
        if (needsNetburnersLevel && numNodes < 10)
          basePriority = PurchasePriority.HIGH;

        const priority = adjustPriorityByMult(basePriority, effectiveMoneyMult);

        requests.push({
          id: `hacknet-new-node-${numNodes}`,
          category: "HACKNET",
          priority,
          score: needsNetburnersLevel
            ? 90
            : normalizeRoiToScore(roi, effectiveMoneyMult, 1),
          cost: newNodeCost,
          roi,
          description: `Hacknet ${isServerMode ? "Server" : "Node"} #${numNodes + 1} kaufen`,
          action: {
            script: PATHS.app.actions.hacknet,
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
          effectiveMult: effectiveMoneyMult,
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
          ramGain: stats.ram,
          effectiveMult: effectiveMoneyMult,
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
          effectiveMult: effectiveMoneyMult,
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

      // Cache Upgrades
      if (isServerMode && "cache" in stats) {
        const cacheCost = ns.hacknet.getCacheUpgradeCost(i, 1);
        if (cacheCost > 0 && Number.isFinite(cacheCost)) {
          const currentCache = (stats as any).cache ?? 1;

          let priority = PurchasePriority.LOW;
          let score = 10;

          if (currentCapacity < targetCapNeeded) {
            priority = PurchasePriority.CRITICAL;
            score = 99;
          } else if (fillTimeSeconds < 45) {
            priority = PurchasePriority.HIGH;
            score = 85;
          } else if (fillTimeSeconds < 120) {
            priority = PurchasePriority.MEDIUM;
            score = 50;
          }

          requests.push({
            id: `hacknet-node-${i}-cache`,
            category: "HACKNET",
            priority: adjustPriorityByMult(priority, effectiveMoneyMult),
            score,
            cost: cacheCost,
            roi: fillTimeSeconds < 45 ? 1 / 300 : 0,
            description: `Hacknet Server #${i + 1} Cache (${currentCache} ➔ ${currentCache + 1}) [Fill-Time: ${Math.round(fillTimeSeconds)}s]`,
            action: {
              script: PATHS.app.actions.hacknet,
              args: ["hacknet-upgrade-cache", i, 1],
            },
          });
        }
      }

      for (const upg of upgradeCandidates) {
        if (upg.cost > 0 && Number.isFinite(upg.cost)) {
          const roi = calculateRoi(upg.cost, currentGain, upg.nextGain);

          let basePriority = getPriorityFromRoi(
            roi,
            isServerMode,
            upg.ramGain,
            totalHacknetRam,
          );
          let score = normalizeRoiToScore(roi, upg.effectiveMult, upg.ramGain);

          if (upg.type === "ram" && stats.ram < MIN_TARGET_RAM) {
            basePriority =
              stats.ram < 4 ? PurchasePriority.CRITICAL : PurchasePriority.HIGH;
            score = Math.max(score, 98 - stats.ram);
          }

          if (needsNetburnersLevel && upg.type === "level") {
            basePriority =
              player.skills.hacking >= 80
                ? PurchasePriority.CRITICAL
                : PurchasePriority.HIGH;
            score = Math.max(score, 100 - stats.level);
          }

          const priority = adjustPriorityByMult(
            basePriority,
            upg.effectiveMult,
          );

          requests.push({
            id: `hacknet-node-${i}-${upg.type}`,
            category: "HACKNET",
            priority,
            score,
            cost: upg.cost,
            roi,
            description: `Hacknet ${isServerMode ? "Server" : "Node"} #${i + 1} ${upg.desc}`,
            action: {
              script: PATHS.app.actions.hacknet,
              args: [upg.actArg, i, 1],
            },
          });
        }
      }
    }

    return requests
      .filter((req) => {
        if (needsNetburnersLevel && req.id.includes("-level")) return true;
        if (needsNetburnersLevel && req.id.startsWith("hacknet-new-node"))
          return true;
        if (needsNetburnersRam && req.id.includes("-ram")) return true;
        if (needsNetburnersCores && req.id.includes("-core")) return true;

        if (isServerMode && req.id.includes("-cache")) return true;
        if (isServerMode && req.id.includes("-ram")) {
          const nodeIdx = Number(req.id.split("-")[2]);
          const currentRam = ns.hacknet.getNodeStats(nodeIdx).ram;
          return evaluateServerRamUpgrade(
            req,
            ns,
            isCapacityBlocked,
            currentRam,
          );
        }
        if (isServerMode && req.id.startsWith("hacknet-new-node")) return true;

        return req.roi >= MIN_ROI && req.score !== undefined && req.score > 0;
      })
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return (b.score ?? 0) - (a.score ?? 0);
      });
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, HacknetEvaluator);
}