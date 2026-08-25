import { NS } from "@ns";
import { BatchStrategy } from "/shared/types/batcher.js";
import { evaluateTargets } from "./target-selection";
import { loadBnMults } from "/lib/utils";

export interface StrategyRecommendation {
  strategy: BatchStrategy;
  reason: string;
  yieldFactor: number;
  effectiveRam: number;
  preferredTarget?: string;
}

export function evaluateHackingStrategy(ns: NS): StrategyRecommendation {
  const playerSkill = ns.getHackingLevel();

  // Zentralisiertes Laden der Multiplikatoren über lib/utils
  const mults = loadBnMults(ns);

  const serverMaxMoney = mults.ServerMaxMoney ?? 1.0;
  const scriptHackMoney = mults.ScriptHackMoney ?? 1.0;
  const scriptHackMoneyGain = mults.ScriptHackMoneyGain ?? 1.0;
  const serverStartingSecurity = mults.ServerStartingSecurity ?? 1.0;
  const hackingSpeedMultiplier = mults.HackingSpeedMultiplier ?? 1.0;
  const serverWeakenRate = mults.ServerWeakenRate ?? 1.0;

  // Echtes Geld-Ertragspotenzial pro Hack
  const yieldFactor = serverMaxMoney * scriptHackMoney * scriptHackMoneyGain;

  // Tatsächlich installierter RAM auf home
  const effectiveRam = ns.getServerMaxRam("home");

  // Risiko von Desynchronisationen bei schwachen Weaken/Hacking-Werten
  const desyncRisk =
    serverStartingSecurity / (hackingSpeedMultiplier * serverWeakenRate);

  let strategy: BatchStrategy = "SHOTGUN_HWGW";
  let reason = "";

  if (playerSkill < 30 || yieldFactor === 0) {
    strategy = "XP_GRIND";
    reason =
      playerSkill < 30
        ? `Hacking-Skill zu niedrig (${playerSkill} < 30). Fokus auf XP-Grind.`
        : `Yield-Factor ist 0 (kein Geldzuwachs möglich). Fokus auf XP-Grind.`;
  } else if (yieldFactor < 0.05) {
    strategy = "WORKER";
    reason = `Geld-Multiplikator extrem niedrig (Yield Factor: ${yieldFactor.toFixed(3)}). Batching unrentabel.`;
  } else if (effectiveRam < 128) {
    strategy = "WORKER";
    reason = `Zu wenig RAM (${effectiveRam} GB). Skript-Prozesse überschreiten RAM-Limit.`;
  } else if (!ns.fileExists("Formulas.exe", "home") && effectiveRam < 1024) {
    strategy = "PROTO_BATCH";
    reason =
      "Keine Formulas.exe und moderater RAM. Sequentieller Proto-Batch ist am stabilsten.";
  } else if (!ns.fileExists("Formulas.exe", "home")) {
    strategy = "SHOTGUN_HWGW";
    reason =
      "Viel RAM vorhanden, aber keine Formulas.exe. Shotgun/Burst HWGW bietet optimalen Durchsatz.";
  } else if (desyncRisk <= 2.0 && effectiveRam >= 1024) {
    strategy = "JIT_HWGW";
    reason =
      "High Yield, Formulas.exe vorhanden und hohes RAM-Budget. Maximale JIT-Pipeline Effizienz.";
  } else {
    strategy = "SHOTGUN_HWGW";
    reason =
      "Gute Rahmenbedingungen, aber erhöhtes Desync-Risiko durch Server-Sicherheit.";
  }

  // Target-Ermittlung über target-selection.ts
  let preferredTarget: string | undefined;

  if (strategy === "XP_GRIND") {
    preferredTarget = "joesguns";
  } else {
    const targets = evaluateTargets(ns, strategy);
    if (targets.length > 0) {
      preferredTarget = targets[0].hostname;
    }
  }

  return {
    strategy,
    reason,
    yieldFactor,
    effectiveRam,
    preferredTarget,
  };
}
