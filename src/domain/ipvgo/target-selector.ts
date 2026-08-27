import { BitNodeMultipliers } from "@ns";
import { GoOpponent } from "/shared/types/ipvgo.js";

export interface GameContext {
  playerKarma: number;
  inGang: boolean;
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

    // 1. BitNode-Multiplikatoren
    const hacknetMult = context.bnMults.HacknetNodeMoney ?? 1;
    const crimeMult = context.bnMults.CrimeMoney ?? 1;
    const hackingMult = context.bnMults.ScriptHackMoney ?? 1;

    scores["Netburners"] *= hacknetMult;
    scores["Slum Snakes"] *= crimeMult;
    scores["The Black Hand"] *= hackingMult;

    // 2. Karma & Gang-Status (Slum Snakes priorisieren vor -54 Karma)
    if (!context.inGang && context.playerKarma > -54) {
      scores["Slum Snakes"] += 400;
    }

    // 3. Game Stage Gewichtung
    if (context.hackingLevel < 300) {
      scores["Netburners"] += 100;
    } else {
      scores["The Black Hand"] += 250;
    }

    // 4. Aggressive Sättigung (Diminishing Returns)
    for (const opp of this.VIABLE_OPPONENTS) {
      const wins = context.opponentWins[opp] || 0;

      // Sobald Netburners > 500 Siege hat, extrem abwerten (Favor Cap erreicht)
      if (opp === "Netburners" && wins >= 500) {
        scores[opp] -= 500;
      } else {
        // Skalierender Abzug ohne harte 150er Deckelung
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
      context.playerKarma > -54
    ) {
      reason += " (Karma-Farmen für Gang)";
    } else if (bestTarget === "The Black Hand") {
      reason += " (Hacking-Money Favor Fokus)";
    } else if (bestTarget === "Netburners") {
      reason += " (Early-Game Hacknet-Boost)";
    }

    return { target: bestTarget, reason };
  }
}
