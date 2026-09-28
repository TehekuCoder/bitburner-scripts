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

  /** Karma-Schwelle für Gang-Gründung in Bitburner */
  private static readonly GANG_KARMA_THRESHOLD = -54000;

  public static selectBestOpponent(context: GameContext): {
    target: GoOpponent;
    reason: string;
  } {
    const scores: Record<GoOpponent, number> = {
      Netburners: 100,
      "Slum Snakes": 100,
      Tetrads: 100,
      "The Black Hand": 100,
      Daedalus: -Infinity,
      Illuminati: -Infinity,
    };

    // 1. BitNode-Multiplikatoren einberechnen
    const hacknetMult = context.bnMults.HacknetNodeMoney ?? 1;
    const crimeMult = context.bnMults.CrimeMoney ?? 1;
    const hackingMult = context.bnMults.ScriptHackMoney ?? 1;
    const classMult = context.bnMults.ClassGymExpGain ?? 1;

    scores["Netburners"] *= hacknetMult;
    scores["Slum Snakes"] *= crimeMult;
    scores["The Black Hand"] *= hackingMult;
    scores["Tetrads"] *= classMult;

    // 2. Karma & Gang-Status (Slum Snakes priorisieren vor -54.000 Karma)
    if (
      !context.inGang &&
      context.playerKarma > TargetSelector.GANG_KARMA_THRESHOLD
    ) {
      scores["Slum Snakes"] += 400;
    }

    // 3. Bladeburner-Fokus (Tetrads für Kampf-Stats & Slum Snakes für Karma/Crime)
    if (context.inBladeburner) {
      // Tetrads geben signifikante Boni auf Combat-Stats (essentiell für Bladeburner Success Rates)
      scores["Tetrads"] += 350;

      // Falls Bladeburner-Rank noch niedrig ist, hilft auch Slum Snakes für physische Boni
      if ((context.bladeburnerRank ?? 0) < 10000) {
        scores["Slum Snakes"] += 150;
      }
    }

    // 4. Game Stage Gewichtung (Hacking vs. Mid-Game)
    if (context.hackingLevel < 300 && !context.inBladeburner) {
      scores["Netburners"] += 100;
    } else if (!context.inBladeburner) {
      scores["The Black Hand"] += 250;
    }

    // 5. Aggressive Sättigung (Diminishing Returns per Gegner)
    for (const opp of this.VIABLE_OPPONENTS) {
      const wins = context.opponentWins[opp] || 0;

      // Sobald Netburners > 500 Siege hat, extrem abwerten (Favor Cap erreicht)
      if (opp === "Netburners" && wins >= 500) {
        scores[opp] -= 500;
      } else {
        scores[opp] -= wins * 0.8;
      }
    }

    // Höchsten Score ermitteln
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
