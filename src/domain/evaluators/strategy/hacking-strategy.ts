import { NS } from "@ns";
import { BatchStrategy } from "/shared/types/batcher.js";
import { evaluateTargets, getAllServers } from "./target-selection";
import { loadBnMults } from "/lib/utils";
import { getWorkerMaxUsableRam } from "/infrastructure/network/network";

export interface StrategyRecommendation {
  strategy: BatchStrategy;
  reason: string;
  yieldFactor: number;
  totalNetworkRam: number;
  preferredTarget?: string;
}

function getTotalNetworkRam(ns: NS): number {
  const servers = getAllServers(ns);
  let totalRam = 0;

  for (const host of servers) {
    if (!ns.hasRootAccess(host)) continue;
    totalRam += getWorkerMaxUsableRam(ns, host, "hacking");
  }

  return totalRam;
}

function shouldUseJit(
  hasFormulas: boolean,
  totalNetworkRam: number,
  desyncRisk: number,
  currentStrategy: BatchStrategy | null | undefined,
): boolean {
  if (!hasFormulas) return false;

  const enterRam = 1024;
  const exitRam = 896;
  const enterDesync = 2.0;
  const exitDesync = 2.3;
  const effectiveStrategy = currentStrategy ?? null;

  if (effectiveStrategy === "JIT_HWGW") {
    return totalNetworkRam >= exitRam && desyncRisk <= exitDesync;
  }

  return totalNetworkRam >= enterRam && desyncRisk <= enterDesync;
}

export function evaluateHackingStrategy(
  ns: NS,
  currentStrategy?: BatchStrategy | null,
): StrategyRecommendation {
  const playerSkill = ns.getHackingLevel();
  const mults = loadBnMults(ns);

  const serverMaxMoney = mults.ServerMaxMoney ?? 1.0;
  const scriptHackMoney = mults.ScriptHackMoney ?? 1.0;
  const scriptHackMoneyGain = mults.ScriptHackMoneyGain ?? 1.0;
  const hackingSpeedMultiplier = mults.HackingSpeedMultiplier ?? 1.0;
  const serverWeakenRate = mults.ServerWeakenRate ?? 1.0;

  const yieldFactor = serverMaxMoney * scriptHackMoney * scriptHackMoneyGain;
  const totalNetworkRam = getTotalNetworkRam(ns);

  const desyncRisk =
    hackingSpeedMultiplier > 0 && serverWeakenRate > 0
      ? 1 / (hackingSpeedMultiplier * serverWeakenRate)
      : Infinity;

  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  let strategy: BatchStrategy = "SHOTGUN_HWGW";
  let reason = "";

  if (playerSkill < 30 || yieldFactor === 0) {
    strategy = "XP_GRIND";
    reason = "Fokus auf XP-Grind.";
  } else if (totalNetworkRam < 64) {
    strategy = "BOOTSTRAP";
    reason =
      "Netzwerk noch im Bootstrap-Setup; Worker-Phase ist noch zu klein.";
  } else if (yieldFactor < 0.05 || totalNetworkRam < 128) {
    strategy = "WORKER";
    reason = "Netz-RAM oder Ertrag zu gering für Batching.";
  } else if (!hasFormulas && totalNetworkRam < 1024) {
    strategy = "PROTO_BATCH";
    reason = "Keine Formulas.exe und moderates Netz-RAM.";
  } else if (!hasFormulas) {
    strategy = "SHOTGUN_HWGW";
    reason = "Hohes Netz-RAM, aber keine Formulas.exe.";
  } else if (
    shouldUseJit(hasFormulas, totalNetworkRam, desyncRisk, currentStrategy)
  ) {
    strategy = "JIT_HWGW";
    reason =
      "Formulas.exe vorhanden, ausreichend Netz-RAM & stabiler Desync-Bereich. Hysterese aktiv.";
  } else {
    strategy = "SHOTGUN_HWGW";
    reason =
      "JIT-Bedingungen nicht stabil genug; auf robuste Shotgun-Logik zurückgefallen.";
  }

  let preferredTarget: string | undefined;

  if (strategy === "XP_GRIND") {
    preferredTarget = getBestXpTarget(ns);
  } else {
    const targetStrategy = strategy === "BOOTSTRAP" ? "WORKER" : strategy;
    const targets = evaluateTargets(ns, targetStrategy);
    if (targets.length > 0) {
      preferredTarget = targets[0].hostname;
    }
  }

  return {
    strategy,
    reason,
    yieldFactor,
    totalNetworkRam,
    preferredTarget,
  };
}

function getBestXpTarget(ns: NS): string {
  const purchasedServers = new Set(ns.cloud.getServerNames());
  const servers = getAllServers(ns).filter(
    (s) =>
      s !== "home" &&
      !purchasedServers.has(s) &&
      !s.startsWith("hacknet-") &&
      ns.hasRootAccess(s) &&
      ns.getServerRequiredHackingLevel(s) <= ns.getHackingLevel(),
  );

  if (servers.length === 0) return "n00dles";

  servers.sort((a, b) => ns.getWeakenTime(a) - ns.getWeakenTime(b));
  return servers[0];
}
