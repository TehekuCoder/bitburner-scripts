import { NS } from "@ns";
import { BatchStrategy } from "/shared/types/batcher.js";
import { evaluateTargets, getAllServers } from "./target-selection";
import { loadBnMults } from "/lib/utils";

export interface StrategyRecommendation {
  strategy: BatchStrategy;
  reason: string;
  yieldFactor: number;
  totalNetworkRam: number;
  preferredTarget?: string;
}

/**
  Berechnet den gesamten verfügbaren Max-RAM im gerooteten Netzwerk.
  Zieht auf 'home' einen Puffer für Verwaltungsskripte ab.
 */
function getTotalNetworkRam(ns: NS): number {
  const HOME_RESERVE_RAM = 32; // GB Puffer für Manager/UI-Skripte auf home
  const servers = getAllServers(ns);
  let totalRam = 0;

  for (const host of servers) {
    if (!ns.hasRootAccess(host)) continue;

    const maxRam = ns.getServerMaxRam(host);
    if (host === "home") {
      totalRam += Math.max(0, maxRam - HOME_RESERVE_RAM);
    } else {
      totalRam += maxRam;
    }
  }

  return totalRam;
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
  const serverStartingSecurity = mults.ServerStartingSecurity ?? 1.0;
  const hackingSpeedMultiplier = mults.HackingSpeedMultiplier ?? 1.0;
  const serverWeakenRate = mults.ServerWeakenRate ?? 1.0;

  const yieldFactor = serverMaxMoney * scriptHackMoney * scriptHackMoneyGain;
  const totalNetworkRam = getTotalNetworkRam(ns);

  const desyncRisk =
    serverStartingSecurity / (hackingSpeedMultiplier * serverWeakenRate);

  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  // Hysterese-Schwellenwerte definieren
  const isCurrentlyJit = currentStrategy === "JIT_HWGW";
  const ramThreshold = isCurrentlyJit ? 896 : 1024; // Behalte JIT bereits ab 896 GB RAM
  const desyncThreshold = isCurrentlyJit ? 2.2 : 2.0; // Toleranz bei leicht erhöhtem Risiko

  let strategy: BatchStrategy = "SHOTGUN_HWGW";
  let reason = "";

  if (playerSkill < 30 || yieldFactor === 0) {
    strategy = "XP_GRIND";
    reason = "Fokus auf XP-Grind.";
  } else if (yieldFactor < 0.05 || totalNetworkRam < 128) {
    strategy = "WORKER";
    reason = "Netz-RAM oder Ertrag zu gering für Batching.";
  } else if (!hasFormulas && totalNetworkRam < 1024) {
    strategy = "PROTO_BATCH";
    reason = "Keine Formulas.exe und moderates Netz-RAM.";
  } else if (!hasFormulas) {
    strategy = "SHOTGUN_HWGW";
    reason = "Hohes Netz-RAM, aber keine Formulas.exe.";
  } else if (desyncRisk <= desyncThreshold && totalNetworkRam >= ramThreshold) {
    strategy = "JIT_HWGW";
    reason =
      "Formulas.exe vorhanden, ausreichend Netz-RAM & stabiles Desync-Risiko.";
  } else {
    strategy = "SHOTGUN_HWGW";
    reason =
      "Gute Rahmenbedingungen, aber Desync-Risiko oder RAM für JIT grenzwertig.";
  }

  // 2. Entkoppelte Ziel-Ermittlung
  let preferredTarget: string | undefined;

  if (strategy === "XP_GRIND") {
    // XP-Best-Target: Niedrigstes Level / Schnellster Weaken-Zyklus (z. B. n00dles oder joesguns)
    preferredTarget = getBestXpTarget(ns);
  } else {
    // Reines Ertrags-Rating ohne Verzerrung durch die Strategie-Formel
    const targets = evaluateTargets(ns, "WORKER"); // Übermittelt 'WORKER', um reine Ertrags-Formel zu erzwingen
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

/**
 * Ermittelt den optimalen Server für reinen XP-Gewinn.
 */
function getBestXpTarget(ns: NS): string {
  const servers = getAllServers(ns).filter(
    (s) =>
      s !== "home" &&
      !s.startsWith("cloud-") &&
      !s.startsWith("hacknet-") &&
      ns.hasRootAccess(s) &&
      ns.getServerRequiredHackingLevel(s) <= ns.getHackingLevel(),
  );

  if (servers.length === 0) return "n00dles";

  // Sortiert nach der kürzesten Weaken-Zeit bei Min-Security
  servers.sort((a, b) => ns.getWeakenTime(a) - ns.getWeakenTime(b));
  return servers[0];
}
