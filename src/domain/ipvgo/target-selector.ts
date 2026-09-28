import { BitNodeMultipliers } from "@ns";
import { GoOpponent } from "/shared/types/ipvgo.js";

export interface GameContext {
  playerKarma: number;
  inGang: boolean;
  inBladeburner?: boolean;
  bladeburnerRank?: number;
  hackingLevel: number;
  bnMults: BitNodeMultipliers;
  opponentWins: Record<GoOpponent, number>;
}

export class TargetSelector {
  private static readonly VIABLE_OPPONENTS: GoOpponent[] = [
    "Netburners",
    "Slum Snakes",
    "Tetrads",
    "The Black Hand",
  ];

  private static readonly GANG_KARMA_THRESHOLD = -54000;

  public static selectBestOpponent(context: GameContext): {
    target: GoOpponent;
    reason: string;
  } {
    // 100 als Basisgewichtung (100%), erfordert vollständige Abdeckung von GoOpponent
    const scores: Record<GoOpponent, number> = {
      Netburners: 100,
      "Slum Snakes": 100,
      Tetrads: 100,
      "The Black Hand": 100,
      Daedalus: -Infinity,
      Illuminati: -Infinity,
      "????????????": -Infinity,
      "No AI": -Infinity,
    };

    // BitNode-Multiplikatoren anwenden
    const hacknetMult = context.bnMults.HacknetNodeMoney ?? 1;
    const crimeMult = context.bnMults.CrimeMoney ?? 1;
    const hackingMult = context.bnMults.ScriptHackMoney ?? 1;
    const classMult = context.bnMults.ClassGymExpGain ?? 1;

    scores["Netburners"] *= hacknetMult;
    scores["Slum Snakes"] *= crimeMult;
    scores["The Black Hand"] *= hackingMult;
    scores["Tetrads"] *= classMult;

    // Gang-Vorbereitung (Karma sammeln über Slum Snakes)
    if (
      !context.inGang &&
      context.playerKarma > TargetSelector.GANG_KARMA_THRESHOLD
    ) {
      scores["Slum Snakes"] += 400;
    }

    // Bladeburner-Fokus
    if (context.inBladeburner) {
      scores["Tetrads"] += 350;
      if ((context.bladeburnerRank ?? 0) < 10000) {
        scores["Slum Snakes"] += 150;
      }
    }

    // Hacking-Stage
    if (context.hackingLevel < 300 && !context.inBladeburner) {
      scores["Netburners"] += 100;
    } else if (!context.inBladeburner) {
      scores["The Black Hand"] += 250;
    }

    // Diminishing Returns per Opponent
    for (const opp of this.VIABLE_OPPONENTS) {
      const wins = context.opponentWins[opp] || 0;
      if (opp === "Netburners" && wins >= 500) {
        scores[opp] -= 500;
      } else {
        scores[opp] -= wins * 0.8;
      }
    }

    let bestTarget: GoOpponent = "The Black Hand";
    let maxScore = -Infinity;

    for (const opp of this.VIABLE_OPPONENTS) {
      if (scores[opp] > maxScore) {
        maxScore = scores[opp];
        bestTarget = opp;
      }
    }

    let reason = `Score: ${Math.round(maxScore)}`;
    if (
      bestTarget === "Slum Snakes" &&
      !context.inGang &&
      context.playerKarma > TargetSelector.GANG_KARMA_THRESHOLD
    ) {
      const remainingKarma = Math.abs(
        TargetSelector.GANG_KARMA_THRESHOLD - context.playerKarma,
      ).toFixed(0);
      reason += ` (Karma für Gang, noch ${remainingKarma})`;
    } else if (bestTarget === "Tetrads" && context.inBladeburner) {
      reason += " (Bladeburner Combat-Stats Boost)";
    } else if (bestTarget === "The Black Hand") {
      reason += " (Hacking-Money Favor Fokus)";
    } else if (bestTarget === "Netburners") {
      reason += " (Early-Game Hacknet-Boost)";
    }

    return { target: bestTarget, reason };
  }
}