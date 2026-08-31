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

  // BitNode Multiplier mit sicheren Fallbacks laden
  let serverGrowthMult = 1.0;
  let scriptHackMoney = 1.0;
  let scriptHackMoneyGain = 1.0;

  try {
    const bnMults = loadBnMults(ns);
    serverGrowthMult = bnMults.ServerGrowthRate ?? 1.0;
    scriptHackMoney = bnMults.ScriptHackMoney ?? 1.0;
    scriptHackMoneyGain = bnMults.ScriptHackMoneyGain ?? 1.0;
  } catch {
    // Fallback auf Standardwerte (BitNode 1) bei Fehlern
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
      // 🟢 Exakte Berechnung via Formulas API
      const simulatedServer: Server = {
        ...server,
        hackDifficulty: minDiff,
        moneyAvailable: maxMoney,
      };
      weakenTime = ns.formulas.hacking.weakenTime(simulatedServer, player);
      chance = ns.formulas.hacking.hackChance(simulatedServer, player);
    } else {
      // 🟡 Fallback ohne Formulas.exe: Weaken-Zeit & Chance auf Min-Security umrechnen
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
        (maxMoney * (effectiveGrowth / 100) * scriptHackMoneyGain) /
        Math.max(1, weakenTime / 1000);
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
