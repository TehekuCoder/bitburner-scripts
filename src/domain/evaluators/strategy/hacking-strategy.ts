import { NS } from "@ns";
import { BatchStrategy } from "/shared/types/batcher.js";
import { evaluateTargets } from "./target-selection";

export interface StrategyRecommendation {
  strategy: BatchStrategy;
  reason: string;
  yieldFactor: number;
  effectiveRam: number;
  preferredTarget?: string;
}

export function evaluateHackingStrategy(ns: NS): StrategyRecommendation {
  const playerSkill = ns.getHackingLevel();

  let mults = {
    ServerMaxMoney: 1,
    ScriptHackMoney: 1,
    HomeComputerRamCost: 1,
    ServerStartingSecurity: 1,
    HackingSpeedMultiplier: 1,
    ServerWeakenRate: 1,
  };

  try {
    mults = ns.getBitNodeMultipliers();
  } catch {
    // Fallback falls BN5 (Source-File 5) noch nicht aktiv ist
  }

  const yieldFactor = mults.ServerMaxMoney * mults.ScriptHackMoney;
  const hasFormulas = ns.fileExists("Formulas.exe", "home");
  const homeRam = ns.getServerMaxRam("home");
  const effectiveRam = homeRam / mults.HomeComputerRamCost;
  const desyncRisk =
    mults.ServerStartingSecurity /
    (mults.HackingSpeedMultiplier * mults.ServerWeakenRate);

  let strategy: BatchStrategy = "SHOTGUN_HWGW";
  let reason = "";

  // 0. XP_GRIND Check: Early-Game (< 30 Skill) oder Null-Ertrag BitNodes
  if (playerSkill < 30 || yieldFactor === 0) {
    strategy = "XP_GRIND";
    reason =
      playerSkill < 30
        ? `Hacking-Skill zu niedrig (${playerSkill} < 30). Fokus auf XP-Grind.`
        : `Yield-Factor ist 0 (kein Geldzuwachs möglich). Fokus auf XP-Grind.`;
  }
  // 1. Extrem reduzierter Ertrag (z.B. BN9) oder sehr wenig RAM -> WORKER
  else if (yieldFactor < 0.05) {
    strategy = "WORKER";
    reason = `Geld-Multiplikator extrem niedrig (Yield Factor: ${yieldFactor.toFixed(3)}). Batching unrentabel.`;
  } else if (effectiveRam < 128) {
    strategy = "WORKER";
    reason = `Zu wenig effektiver RAM (${Math.round(effectiveRam)} GB). Skript-Prozesse überschreiten RAM-Limit.`;
  }
  // 2. Kein Formulas.exe + moderater RAM -> PROTO_BATCH
  else if (!hasFormulas && effectiveRam < 1024) {
    strategy = "PROTO_BATCH";
    reason =
      "Keine Formulas.exe und moderater RAM. Sequentieller Proto-Batch ist am stabilsten.";
  }
  // 3. Viel RAM, aber kein Formulas.exe -> SHOTGUN_HWGW
  else if (!hasFormulas) {
    strategy = "SHOTGUN_HWGW";
    reason =
      "Viel RAM vorhanden, aber keine Formulas.exe. Shotgun/Burst HWGW bietet optimalen Durchsatz.";
  }
  // 4. Formulas.exe vorhanden & hohes RAM-Budget -> JIT_HWGW
  else if (desyncRisk <= 2.0 && effectiveRam >= 1024) {
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
