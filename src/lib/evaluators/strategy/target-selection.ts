import { NS, Server } from "@ns";
import { BatchStrategy } from "/lib/types/batcher";

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

export function evaluateTargets(ns: NS, strategy: BatchStrategy): TargetScore[] {
  const player = ns.getPlayer();
  const allServers = getAllServers(ns);
  const targets: TargetScore[] = [];

  for (const host of allServers) {
    if (host === "home" || host.startsWith("pserv-")) continue;
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

    const weakenTime = ns.formulas?.hacking
      ? ns.formulas.hacking.weakenTime(simulatedServer, player)
      : ns.getWeakenTime(host);

    let score = 0;

    if (strategy === "WORKER") {
      // Fokus auf Erfolgschance x Geld pro Zeit
      const chance = ns.formulas?.hacking
        ? ns.formulas.hacking.hackChance(simulatedServer, player)
        : ns.hackAnalyzeChance(host);

      score = (maxMoney * chance) / (weakenTime / 1000);
    } else {
      // Fokus auf rein theoretischen Durchsatz unter Min-Security
      const growthRate = server.serverGrowth ?? 1;
      score = (maxMoney * (growthRate / 100)) / (weakenTime / 1000);
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