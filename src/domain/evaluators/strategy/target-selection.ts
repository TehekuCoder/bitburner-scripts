import { NS, Server } from "@ns";
import { BatchStrategy } from "/shared/types/batcher";
import { loadBnMults } from "/lib/utils";

export interface TargetScore {
  hostname: string;
  score: number;
  maxMoney: number;
  minDifficulty: number;
  weakenTimeMs: number;
  requiredHackingLevel: number;
}

export function getAllServers(ns: NS): string[] {
  const visited = new Set<string>(["home"]);
  const queue = ["home"];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = ns.scan(current);

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return Array.from(visited);
}

export function evaluateTargets(
  ns: NS,
  strategy: BatchStrategy,
): TargetScore[] {
  const player = ns.getPlayer();
  const playerSkill = player.skills.hacking;
  const allServers = getAllServers(ns);
  const targets: TargetScore[] = [];

  let serverGrowthMult = 1.0;
  let scriptHackMoney = 1.0;
  let scriptHackMoneyGain = 1.0;

  try {
    const bnMults = loadBnMults(ns);
    serverGrowthMult = bnMults.ServerGrowthRate ?? 1.0;
    scriptHackMoney = bnMults.ScriptHackMoney ?? 1.0;
    scriptHackMoneyGain = bnMults.ScriptHackMoneyGain ?? 1.0;
  } catch {
    // Fallback BitNode 1
  }

  for (const host of allServers) {
    if (
      host === "home" ||
      host.startsWith("cloud-") ||
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

    let weakenTime = 0;
    let chance = 0;

    if (ns.formulas?.hacking) {
      const simulatedServer: Server = {
        ...server,
        hackDifficulty: minDiff,
        moneyAvailable: maxMoney,
      };
      weakenTime = ns.formulas.hacking.weakenTime(simulatedServer, player);
      chance = ns.formulas.hacking.hackChance(simulatedServer, player);
    } else {
      const currentWeakenTime = ns.getWeakenTime(host);
      weakenTime = currentWeakenTime * ((minDiff + 50) / (curDiff + 50));

      const reqHacking = Math.max(1, reqLevel);
      const skillMult = Math.max(
        0,
        (1.75 * playerSkill - reqHacking) / (1.75 * playerSkill),
      );
      const secMult = (100 - minDiff) / 100;
      chance = Math.min(1.0, Math.max(0.01, skillMult * secMult));
    }

    let score = 0;

    if (strategy === "WORKER") {
      const moneyFactor = maxMoney * scriptHackMoney * scriptHackMoneyGain;
      score = (moneyFactor * chance) / Math.max(1, weakenTime / 1000);
    } else {
      const effectiveGrowth = (server.serverGrowth ?? 1) * serverGrowthMult;
      score =
        ((maxMoney * (effectiveGrowth / 100) * scriptHackMoneyGain) /
          Math.max(1, weakenTime / 1000)) *
        Math.pow(chance, 2);
    }

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
