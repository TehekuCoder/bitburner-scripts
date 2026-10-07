import { NS, Server } from "@ns";
import { BatchStrategy } from "/shared/types/batcher";
import { loadBnMults } from "/lib/utils";
import { getAllServers as getNetworkServers } from "/infrastructure/network/network";
import { PATHS } from "/infrastructure/runtime/paths";
import {
  GROW_SECURITY_PER_THREAD,
  HACK_SECURITY_PER_THREAD,
  getWeakenEffectPerThread,
  getWeakenThreadsForSecurity,
} from "/domain/hacking/weaken";

const BATCH_HACK_FRACTION = 0.1;
const MAX_HACK_FRACTION = 0.9;
const DEFAULT_SCRIPT_RAM = {
  hack: 1.7,
  grow: 1.75,
  weaken: 1.75,
  work: 1.7,
};

function getScriptRam(ns: NS, script: string, fallback: number): number {
  const ram = ns.getScriptRam(script, "home");
  return Number.isFinite(ram) && ram > 0 ? ram : fallback;
}

export interface TargetScore {
  hostname: string;
  score: number;
  maxMoney: number;
  minDifficulty: number;
  weakenTimeMs: number;
  requiredHackingLevel: number;
}

export function getAllServers(ns: NS): string[] {
  return getNetworkServers(ns);
}

export function evaluateTargets(
  ns: NS,
  strategy: BatchStrategy,
): TargetScore[] {
  const player = ns.getPlayer();
  const playerSkill = player.skills.hacking;
  const allServers = getAllServers(ns);
  const purchasedServers = new Set(ns.cloud.getServerNames());
  const targets: TargetScore[] = [];

  let scriptHackMoneyGain = 1.0;
  let serverWeakenRate = 1.0;

  try {
    const bnMults = loadBnMults(ns);
    scriptHackMoneyGain = bnMults.ScriptHackMoneyGain ?? 1.0;
    serverWeakenRate = bnMults.ServerWeakenRate ?? 1.0;
  } catch {
    // Fallback BitNode 1
  }

  const weakenEffect = getWeakenEffectPerThread(serverWeakenRate);
  if (weakenEffect <= 0) return targets;

  const hackRam = getScriptRam(
    ns,
    PATHS.services.payloads.hack,
    DEFAULT_SCRIPT_RAM.hack,
  );
  const growRam = getScriptRam(
    ns,
    PATHS.services.payloads.grow,
    DEFAULT_SCRIPT_RAM.grow,
  );
  const weakenRam = getScriptRam(
    ns,
    PATHS.services.payloads.weaken,
    DEFAULT_SCRIPT_RAM.weaken,
  );
  const workRam = getScriptRam(
    ns,
    PATHS.services.payloads.work,
    DEFAULT_SCRIPT_RAM.work,
  );

  for (const host of allServers) {
    if (
      host === "home" ||
      purchasedServers.has(host) ||
      host.startsWith("hacknet-")
    )
      continue;
    if (!ns.hasRootAccess(host)) continue;

    const server = ns.getServer(host);
    const maxMoney = server.moneyMax ?? 0;
    const reqLevel = server.requiredHackingSkill ?? 1;

    if (maxMoney <= 0 || reqLevel > playerSkill) continue;

    const minDiff = server.minDifficulty ?? 1;
    const curDiff = server.hackDifficulty ?? 100;

    let hackTime: number;
    let growTime: number;
    let weakenTime: number;
    let hackPercent: number;
    let chance: number;

    if (ns.formulas?.hacking) {
      const simulatedServer: Server = {
        ...server,
        hackDifficulty: minDiff,
        moneyAvailable: maxMoney,
      };
      hackTime = ns.formulas.hacking.hackTime(simulatedServer, player);
      growTime = ns.formulas.hacking.growTime(simulatedServer, player);
      weakenTime = ns.formulas.hacking.weakenTime(simulatedServer, player);
      chance = ns.formulas.hacking.hackChance(simulatedServer, player);
      hackPercent = ns.formulas.hacking.hackPercent(simulatedServer, player);
    } else {
      const currentWeakenTime = ns.getWeakenTime(host);
      const difficultyRatio = (minDiff + 50) / (curDiff + 50);
      hackTime = ns.getHackTime(host) * difficultyRatio;
      growTime = ns.getGrowTime(host) * difficultyRatio;
      weakenTime = currentWeakenTime * difficultyRatio;

      const reqHacking = Math.max(1, reqLevel);
      const skillMult = Math.max(
        0,
        (1.75 * playerSkill - reqHacking) / (1.75 * playerSkill),
      );
      const secMult = (100 - minDiff) / 100;
      chance = Math.min(1.0, Math.max(0.01, skillMult * secMult));
      hackPercent = ns.hackAnalyze(host);
    }

    if (
      !Number.isFinite(hackTime) ||
      !Number.isFinite(growTime) ||
      !Number.isFinite(weakenTime) ||
      hackTime <= 0 ||
      growTime <= 0 ||
      weakenTime <= 0 ||
      !Number.isFinite(chance) ||
      chance <= 0 ||
      !Number.isFinite(hackPercent) ||
      hackPercent <= 0
    ) {
      continue;
    }

    const maxHackThreads = Math.max(
      1,
      Math.floor(MAX_HACK_FRACTION / hackPercent),
    );
    const hackThreads =
      strategy === "WORKER"
        ? 1
        : Math.max(
            1,
            Math.min(
              maxHackThreads,
              Math.floor(BATCH_HACK_FRACTION / hackPercent),
            ),
          );
    const stolenFraction = Math.min(
      MAX_HACK_FRACTION,
      hackThreads * hackPercent,
    );
    const postHackMoney = Math.max(1, maxMoney * (1 - stolenFraction));
    const postHackServer: Server = {
      ...server,
      hackDifficulty: minDiff,
      moneyAvailable: postHackMoney,
    };

    const rawGrowThreads = ns.formulas?.hacking
      ? ns.formulas.hacking.growThreads(postHackServer, player, maxMoney)
      : ns.growthAnalyze(host, maxMoney / postHackMoney);
    if (!Number.isFinite(rawGrowThreads) || rawGrowThreads <= 0) continue;

    const growThreads = Math.ceil(rawGrowThreads);
    const weaken1Threads = getWeakenThreadsForSecurity(
      hackThreads * HACK_SECURITY_PER_THREAD,
      weakenEffect,
    );
    const weaken2Threads = getWeakenThreadsForSecurity(
      growThreads * GROW_SECURITY_PER_THREAD,
      weakenEffect,
    );
    if (!Number.isFinite(weaken1Threads + weaken2Threads)) continue;

    const expectedProfit =
      maxMoney * stolenFraction * chance * scriptHackMoneyGain;
    const ramSeconds =
      strategy === "WORKER"
        ? (hackThreads * hackTime +
            chance * growThreads * growTime +
            chance * (weaken1Threads + weaken2Threads) * weakenTime) *
          workRam
        : (hackThreads * hackRam * hackTime +
            weaken1Threads * weakenRam * weakenTime +
            growThreads * growRam * growTime +
            weaken2Threads * weakenRam * weakenTime);
    const score =
      Number.isFinite(expectedProfit) &&
      Number.isFinite(ramSeconds) &&
      ramSeconds > 0
        ? (expectedProfit * 1000) / ramSeconds
        : 0;

    targets.push({
      hostname: host,
      score,
      maxMoney,
      minDifficulty: minDiff,
      weakenTimeMs: weakenTime,
      requiredHackingLevel: reqLevel,
    });
  }

  return targets.sort((a, b) => b.score - a.score);
}

export interface TargetSelectionOptions {
  switchMargin?: number;
  minHoldMs?: number;
}

export interface TargetSelectionResult {
  target: string | null;
  hasChanged: boolean;
  reason: string;
}

export function selectBestTarget(
  ns: NS,
  targets: TargetScore[],
  currentTarget: string | null,
  lastTargetChangeTime: number,
  options: TargetSelectionOptions = {},
): TargetSelectionResult {
  if (targets.length === 0)
    return { target: null, hasChanged: false, reason: "Keine Ziele" };

  const topTarget = targets[0];
  if (!currentTarget)
    return {
      target: topTarget.hostname,
      hasChanged: true,
      reason: "Initiales Ziel",
    };
  if (topTarget.hostname === currentTarget)
    return {
      target: currentTarget,
      hasChanged: false,
      reason: "Bestes Ziel aktiv",
    };

  const currentTargetEntry = targets.find((t) => t.hostname === currentTarget);
  if (!currentTargetEntry)
    return {
      target: topTarget.hostname,
      hasChanged: true,
      reason: "Ziel nicht mehr qualifiziert",
    };

  // 1. Dynamische Sperrfrist basierend auf der Weaken-Zeit des AKTUELLEN Targets
  const currentWeakenTime = currentTargetEntry.weakenTimeMs;
  const dynamicMinHoldMs = Math.max(
    options.minHoldMs ?? 60_000,
    currentWeakenTime * 2.5,
  );
  const timeOnCurrentTarget =
    lastTargetChangeTime > 0 ? Date.now() - lastTargetChangeTime : 0;

  if (timeOnCurrentTarget < dynamicMinHoldMs) {
    const remainingSec = (
      (dynamicMinHoldMs - timeOnCurrentTarget) /
      1000
    ).toFixed(0);
    return {
      target: currentTarget,
      hasChanged: false,
      reason: `Pipeline läuft: Sperrfrist aktiv (noch ${remainingSec}s / 2.5x weakenTime).`,
    };
  }

  // 2. PREP-Penalty Check
  const newServer = ns.getServer(topTarget.hostname);
  const needsPrep =
    (newServer.moneyAvailable ?? 0) < (newServer.moneyMax ?? 1) * 0.99 ||
    (newServer.hackDifficulty ?? 99) > (newServer.minDifficulty ?? 1) + 0.05;

  const effectiveMargin = needsPrep
    ? (options.switchMargin ?? 1.15) + 0.25
    : (options.switchMargin ?? 1.15);

  if (currentTargetEntry.score <= 0 && topTarget.score > 0) {
    return {
      target: topTarget.hostname,
      hasChanged: true,
      reason: `Wechsel zu ${topTarget.hostname}: aktuelles Ziel hat keinen positiven Ertragsscore.`,
    };
  }

  if (topTarget.score > currentTargetEntry.score * effectiveMargin) {
    return {
      target: topTarget.hostname,
      hasChanged: true,
      reason: `Wechsel zu ${topTarget.hostname} lohnt sich trotz ${needsPrep ? "PREP-Phase" : "Wechselkosten"} (Score +${((topTarget.score / currentTargetEntry.score - 1) * 100).toFixed(0)}%).`,
    };
  }

  return {
    target: currentTarget,
    hasChanged: false,
    reason: `Vorteil von ${topTarget.hostname} kompensiert die Pipeline-Unterbrechung noch nicht.`,
  };
}
