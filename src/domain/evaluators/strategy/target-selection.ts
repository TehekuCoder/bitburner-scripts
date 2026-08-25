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
    if (host === "home" || host.startsWith("cloud-")) continue;
    if (!ns.hasRootAccess(host)) continue;

    const server = ns.getServer(host);
    const maxMoney = server.moneyMax ?? 0;
    const reqLevel = server.requiredHackingSkill ?? 1;

    if (maxMoney <= 0 || reqLevel > player.skills.hacking) continue;

    const minDiff = server.minDifficulty ?? 1;
    const simulatedServer: Server = {
      ...server,
      hackDifficulty: minDiff,
    };

    // Weaken-Zeit berücksichtigt bereits HackingSpeedMultiplier der Engine
    const weakenTime = ns.formulas?.hacking
      ? ns.formulas.hacking.weakenTime(simulatedServer, player)
      : ns.getWeakenTime(host);

    let score = 0;

    if (strategy === "WORKER") {
      const chance = ns.formulas?.hacking
        ? ns.formulas.hacking.hackChance(simulatedServer, player)
        : ns.hackAnalyzeChance(host);

      // Einbeziehen von ScriptHackMoney (Diebstahl-Menge) UND ScriptHackMoneyGain (Konto-Gutschrift)
      const moneyFactor = maxMoney * scriptHackMoney * scriptHackMoneyGain;
      score = (moneyFactor * chance) / (weakenTime / 1000);
    } else {
      // Effektiv berechnete Growth Rate inkl. ServerGrowthRate Multiplier
      const effectiveGrowth = (server.serverGrowth ?? 1) * serverGrowthMult;
      score =
        (maxMoney * (effectiveGrowth / 100) * scriptHackMoneyGain) /
        (weakenTime / 1000);
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
