import { NS, BitNodeMultipliers } from "@ns";
import { loadBnMults, hasSingularity, hasBladeburner } from "/lib/utils";

export type BladeburnerExecutionMode = "PARALLEL" | "BLADEBURNER_ONLY" | "CLASSIC_ONLY";
export type SleeveBladeburnerRole = "FACTION_REP" | "BLADEBURNER_CONTRACTS" | "BLADEBURNER_DIPLOMACY" | "INFILTRATION";

export interface BladeburnerDecision {
  executionMode: BladeburnerExecutionMode;
  shouldOverrideFactionGrind: boolean;
  recommendedSleeveRole: SleeveBladeburnerRole;
  bladeburnerEfficiencyScore: number;
}

/**
 * Berechnet ein Effizienz-Verhältnis zwischen Bladeburner und klassischem Faction-Grind.
 */
function calculateEfficiencyRatio(mults: BitNodeMultipliers): { bbScore: number; factionScore: number } {
  // Höherer Rank-Gain und niedrigere Skill-Kosten steigern den BB-Score
  const bbRankMult = mults.BladeburnerRank ?? 1;
  const bbCostMult = mults.BladeburnerSkillCost ?? 1;
  const bbScore = bbRankMult / Math.max(0.1, bbCostMult);

  // Höherer Faction-Gain und niedrigere Aug-Rep-Kosten steigern den Faction-Score
  const factionRepMult = mults.FactionWorkRepGain ?? 1;
  const augRepCostMult = mults.AugmentationRepCost ?? 1;
  const factionScore = factionRepMult / Math.max(0.1, augRepCostMult);

  return { bbScore, factionScore };
}

export function evaluateBladeburnerPreference(ns: NS): BladeburnerDecision {
  if (!hasBladeburner(ns) || !ns.bladeburner.inBladeburner()) {
    return {
      executionMode: "CLASSIC_ONLY",
      shouldOverrideFactionGrind: false,
      recommendedSleeveRole: "FACTION_REP",
      bladeburnerEfficiencyScore: 0,
    };
  }

  const bnMults = loadBnMults(ns);
  const { bbScore, factionScore } = calculateEfficiencyRatio(bnMults);
  const currentBN = ns.getResetInfo().currentNode;

  const hasSimulacrum =
    hasSingularity(ns) &&
    ns.singularity
      .getOwnedAugmentations(false)
      .includes("The Blade's Simulacrum");

  // 1️⃣ PARALLELER MODUS (Simulacrum vorhanden)
  if (hasSimulacrum) {
    // Wenn BB im BitNode extrem stark ist, unterstützen Sleeves Bladeburner, sonst Factions
    const sleeveRole: SleeveBladeburnerRole = bbScore >= factionScore 
      ? "BLADEBURNER_CONTRACTS" 
      : "FACTION_REP";

    return {
      executionMode: "PARALLEL",
      shouldOverrideFactionGrind: false,
      recommendedSleeveRole: sleeveRole,
      bladeburnerEfficiencyScore: bbScore,
    };
  }

  // 2️⃣ EXKLUSIVER MODUS (Ohne Simulacrum)
  const isDedicatedBBNode = currentBN === 6 || currentBN === 7;
  const isBladeburnerPreferred = isDedicatedBBNode || bbScore > factionScore * 1.2;

  if (isBladeburnerPreferred) {
    return {
      executionMode: "BLADEBURNER_ONLY",
      shouldOverrideFactionGrind: true,
      // Main-Char macht Bladeburner -> Sleeves müssen den Faction-Rep-Grind übernehmen
      recommendedSleeveRole: "FACTION_REP",
      bladeburnerEfficiencyScore: bbScore,
    };
  }

  return {
    executionMode: "CLASSIC_ONLY",
    shouldOverrideFactionGrind: false,
    recommendedSleeveRole: "FACTION_REP",
    bladeburnerEfficiencyScore: bbScore,
  };
}