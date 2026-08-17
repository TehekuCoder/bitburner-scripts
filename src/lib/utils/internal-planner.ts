import { NS, BitNodeMultipliers, Player, Server } from "@ns";
import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";
import { HOME_RAM_RESERVE, BATCH_GAP } from "../../infrastructure/runtime/batcher";

export interface BatchPlan {
  target: string;
  mode: "PREP" | "HWGW";
  hackThreads: number;
  weaken1Threads: number;
  growThreads: number;
  weaken2Threads: number;
  hackTime: number;
  weakenTime: number;
  growTime: number;
  greed: number;
  greedScore: number;
  maxBatches: number;
  batchRam: number;
}

const MAX_SAFE_CONCURRENT_SCRIPTS = 4000;
const RAM_HACK = 1.7;
const RAM_GROW = 1.75;
const RAM_WEAKEN = 1.75;

function getMinimumWeakenTime(player: Player): number {
  if (player.skills.hacking >= 10_000) return 0;
  if (player.skills.hacking >= 5_000) return 400;
  return 1200;
}

function makeServerState(
  base: Server,
  overrideSec?: number,
  overrideMoney?: number,
): Server {
  return {
    ...base,
    hackDifficulty: overrideSec ?? base.hackDifficulty,
    moneyAvailable: overrideMoney ?? base.moneyAvailable,
  };
}

export function internalPlanner(
  ns: NS,
  servers: string[],
  maxRam: number,
  virtualFreeRam: number,
  bnMults: BitNodeMultipliers,
  player: Player = ns.getPlayer(),
  customLogger?: Logger,
): BatchPlan | null {
  const logger = customLogger ?? new Logger(ns, "PLANNER");

  if (virtualFreeRam < RAM_WEAKEN) {
    return null;
  }

  // 🟢 Ermittle den größten einzelnen Host im Netzwerk für Single-Task Bitburner Limits
  const maxSingleHostRam = servers.reduce((max, s) => {
    if (!ns.hasRootAccess(s)) return max;
    const hostRam =
      s === "home"
        ? Math.max(0, ns.getServerMaxRam("home") - HOME_RAM_RESERVE)
        : ns.getServerMaxRam(s);
    return Math.max(max, hostRam);
  }, 0);

  if (maxSingleHostRam < RAM_WEAKEN) return null;

  const weakenRate = 0.05 * (bnMults?.ServerWeakenRate ?? 1.0);

  let bestPlan: BatchPlan | null = null;
  let highestScore = -1;

  for (const target of servers) {
    if (!ns.hasRootAccess(target)) continue;

    const serverObj = ns.getServer(target);
    if (!serverObj.moneyMax || serverObj.moneyMax <= 0) continue;
    if ((serverObj.requiredHackingSkill ?? Infinity) > player.skills.hacking)
      continue;

    const moneyMax = serverObj.moneyMax;
    const moneyAvailable = serverObj.moneyAvailable ?? 0;
    const minSec = serverObj.minDifficulty ?? 1;
    const currentSec = serverObj.hackDifficulty ?? minSec;

    const isPrepped =
      currentSec <= minSec + 0.5 && moneyAvailable >= moneyMax * 0.99;

    // -----------------------------------------------------------------------
    // PHASE 1: PREP Mode
    // -----------------------------------------------------------------------
    if (!isPrepped) {
      const currentServerState = makeServerState(
        serverObj,
        currentSec,
        moneyAvailable,
      );

      const weakenTime = ns.formulas?.hacking
        ? ns.formulas.hacking.weakenTime(currentServerState, player)
        : ns.getWeakenTime(target);

      if (weakenTime < getMinimumWeakenTime(player)) continue;

      const growTime = ns.formulas?.hacking
        ? ns.formulas.hacking.growTime(currentServerState, player)
        : ns.getGrowTime(target);

      const hackTime = ns.formulas?.hacking
        ? ns.formulas.hacking.hackTime(currentServerState, player)
        : ns.getHackTime(target);

      let weakenPrepThreads = 0;
      let growPrepThreads = 0;
      let prepWeaken2Threads = 0;

      if (currentSec > minSec + 0.5) {
        weakenPrepThreads = Math.max(
          1,
          Math.ceil((currentSec - minSec) / weakenRate),
        );
      }

      if (moneyAvailable < moneyMax * 0.99) {
        const growthFactor = moneyMax / Math.max(1, moneyAvailable);
        const growCalcServer = makeServerState(
          serverObj,
          currentSec,
          Math.max(1, moneyAvailable),
        );

        const rawGrowThreads = ns.formulas?.hacking
          ? ns.formulas.hacking.growThreads(
              growCalcServer,
              player,
              moneyMax,
            )
          : ns.growthAnalyze(target, growthFactor);

        growPrepThreads = Math.max(
          1,
          Math.ceil(rawGrowThreads || growthFactor),
        );
        prepWeaken2Threads = Math.ceil((growPrepThreads * 0.004) / weakenRate);
      }

      // 🟢 Host-Cap Skalierung: Einzelne Task-Gruppen dürfen maxSingleHostRam nicht sprengen
      const maxWeakenThreads = Math.floor(maxSingleHostRam / RAM_WEAKEN);
      const maxGrowThreads = Math.floor(maxSingleHostRam / RAM_GROW);

      weakenPrepThreads = Math.min(weakenPrepThreads, maxWeakenThreads);
      growPrepThreads = Math.min(growPrepThreads, maxGrowThreads);
      prepWeaken2Threads = Math.min(prepWeaken2Threads, maxWeakenThreads);

      let prepRam =
        (weakenPrepThreads + prepWeaken2Threads) * RAM_WEAKEN +
        growPrepThreads * RAM_GROW;
      const maxUsablePrepRam = Math.max(RAM_WEAKEN, virtualFreeRam * 0.5);

      if (prepRam > maxUsablePrepRam) {
        const scale = maxUsablePrepRam / prepRam;
        if (weakenPrepThreads > 0)
          weakenPrepThreads = Math.max(
            1,
            Math.floor(weakenPrepThreads * scale),
          );
        if (growPrepThreads > 0) {
          growPrepThreads = Math.floor(growPrepThreads * scale);
          prepWeaken2Threads =
            growPrepThreads > 0
              ? Math.ceil((growPrepThreads * 0.004) / weakenRate)
              : 0;
        }
        prepRam =
          (weakenPrepThreads + prepWeaken2Threads) * RAM_WEAKEN +
          growPrepThreads * RAM_GROW;
      }

      if (
        !Number.isFinite(prepRam) ||
        prepRam <= 0 ||
        prepRam > maxUsablePrepRam
      )
        continue;

      const prepScore = (moneyMax / Math.max(weakenTime, 1000)) * 0.001;
      if (prepScore > highestScore) {
        highestScore = prepScore;
        bestPlan = {
          target,
          mode: "PREP",
          hackThreads: 0,
          weaken1Threads: weakenPrepThreads,
          growThreads: growPrepThreads,
          weaken2Threads: prepWeaken2Threads,
          hackTime,
          weakenTime,
          growTime,
          greed: 0,
          greedScore: prepScore,
          maxBatches: 1,
          batchRam: prepRam,
        };
      }
      continue;
    }

    // -----------------------------------------------------------------------
    // PHASE 2: HWGW Mode
    // -----------------------------------------------------------------------
    const preppedServerState = makeServerState(serverObj, minSec, moneyMax);

    const weakenTime = ns.formulas?.hacking
      ? ns.formulas.hacking.weakenTime(preppedServerState, player)
      : ns.getWeakenTime(target);

    if (weakenTime < getMinimumWeakenTime(player)) continue;

    const growTime = ns.formulas?.hacking
      ? ns.formulas.hacking.growTime(preppedServerState, player)
      : ns.getGrowTime(target);

    const hackTime = ns.formulas?.hacking
      ? ns.formulas.hacking.hackTime(preppedServerState, player)
      : ns.getHackTime(target);

    const hackChance = ns.formulas?.hacking
      ? ns.formulas.hacking.hackPercent(preppedServerState, player)
      : ns.hackAnalyze(target);

    if (hackChance <= 0) continue;

    const maxPipeBatches = Math.max(1, Math.floor(weakenTime / BATCH_GAP));
    const safeScriptBatches = Math.floor(MAX_SAFE_CONCURRENT_SCRIPTS / 4);

    const maxHackThreads = Math.floor(0.9 / hackChance);
    if (maxHackThreads < 1) continue;

    const evaluateThreadCount = (hackThreads: number): BatchPlan | null => {
      const actualGreed = hackThreads * hackChance;
      if (actualGreed >= 0.95 || actualGreed <= 0) return null;

      const weaken1Threads = Math.ceil((hackThreads * 0.002) / weakenRate);
      const postHackMoney = Math.max(1, moneyMax * (1 - actualGreed));

      const postHackServerState = makeServerState(
        serverObj,
        minSec,
        postHackMoney,
      );

      const growThreads = ns.formulas?.hacking
        ? Math.ceil(
            ns.formulas.hacking.growThreads(
              postHackServerState,
              player,
              moneyMax,
            ),
          ) + 1
        : Math.ceil(ns.growthAnalyze(target, moneyMax / postHackMoney)) + 1;

      const weaken2Threads = Math.ceil((growThreads * 0.004) / weakenRate);

      // 🟢 Host-Cap Validierung: Jeder Teil-Task muss auf EINEN Host passen
      if (
        hackThreads * RAM_HACK > maxSingleHostRam ||
        weaken1Threads * RAM_WEAKEN > maxSingleHostRam ||
        growThreads * RAM_GROW > maxSingleHostRam ||
        weaken2Threads * RAM_WEAKEN > maxSingleHostRam
      ) {
        return null;
      }

      const batchRam =
        hackThreads * RAM_HACK +
        weaken1Threads * RAM_WEAKEN +
        growThreads * RAM_GROW +
        weaken2Threads * RAM_WEAKEN;

      if (
        !Number.isFinite(batchRam) ||
        batchRam > maxRam ||
        batchRam > virtualFreeRam
      ) {
        return null;
      }

      const maxRamBatches = Math.floor(virtualFreeRam / batchRam);
      const activeConcurrentBatches = Math.max(
        1,
        Math.min(maxPipeBatches, maxRamBatches, safeScriptBatches),
      );

      const profitPerBatch = moneyMax * actualGreed;
      const greedScore =
        (profitPerBatch * activeConcurrentBatches) / Math.max(1000, weakenTime);

      return {
        target,
        mode: "HWGW",
        hackThreads,
        weaken1Threads,
        growThreads,
        weaken2Threads,
        hackTime,
        weakenTime,
        growTime,
        greed: actualGreed,
        greedScore,
        maxBatches: activeConcurrentBatches,
        batchRam,
      };
    };

    const stepSize = Math.max(1, Math.floor(maxHackThreads / 40));
    let bestTargetPlan: BatchPlan | null = null;

    for (let hThreads = 1; hThreads <= maxHackThreads; hThreads += stepSize) {
      const plan = evaluateThreadCount(hThreads);
      if (plan && plan.greedScore > (bestTargetPlan?.greedScore ?? -1)) {
        bestTargetPlan = plan;
      }
    }

    if (stepSize > 1) {
      const minPlan = evaluateThreadCount(1);
      if (minPlan && minPlan.greedScore > (bestTargetPlan?.greedScore ?? -1)) {
        bestTargetPlan = minPlan;
      }
    }

    if (bestTargetPlan && bestTargetPlan.greedScore > highestScore) {
      highestScore = bestTargetPlan.greedScore;
      bestPlan = bestTargetPlan;
    }
  }

  if (bestPlan) {
    logger.debug(
      `📊 Optimum berechnet: ${bestPlan.target} [${bestPlan.mode}] | Greed: ${(bestPlan.greed * 100).toFixed(1)}% | Score: ${bestPlan.greedScore.toFixed(0)}`,
      bestPlan.target,
      { context: { mode: bestPlan.mode, maxBatches: bestPlan.maxBatches } },
    );
  }

  return bestPlan;
}