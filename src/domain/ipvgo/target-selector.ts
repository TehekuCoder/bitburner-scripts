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

  /**
   * Wählt basierend auf Kontext, Multiplikatoren und Bisherigen Siegen das beste Ziel aus.
   */
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

    // 1. BitNode-Multiplikatoren einberechnen (Korrekt für Bitburner 3.0)
    const hacknetMult = context.bnMults.HacknetNodeMoney ?? 1;
    const crimeMult = context.bnMults.CrimeMoney ?? 1;
    const hackingMult = context.bnMults.ScriptHackMoney ?? 1;

    scores["Netburners"] *= hacknetMult;
    scores["Slum Snakes"] *= crimeMult;
    scores["The Black Hand"] *= hackingMult;

    // 2. Karma & Gang-Status (Slum Snakes priorisieren vor -54 Karma)
    if (!context.inGang && context.playerKarma > -54) {
      scores["Slum Snakes"] += 300;
    }

    // 3. Early vs. Late Game Gewichtung
    if (context.hackingLevel < 300) {
      scores["Netburners"] += 150;
    } else {
      scores["The Black Hand"] += 200;
    }

    // 4. Sättigung (Diminishing Returns) basierend auf bisherigen Siegen
    for (const opp of this.VIABLE_OPPONENTS) {
      const wins = context.opponentWins[opp] || 0;
      if (wins > 0) {
        // Pro Sieg sinkt die Attraktivität leicht, um Rotation zu fördern
        scores[opp] -= Math.min(wins * 5, 150);
      }
    }

    // Höchsten Score ermitteln
    let bestTarget: GoOpponent = "Netburners";
    let maxScore = -Infinity;

    for (const opp of this.VIABLE_OPPONENTS) {
      if (scores[opp] > maxScore) {
        maxScore = scores[opp];
        bestTarget = opp;
      }
    }

    // Grund für das Logging zusammenstellen
    let reason = `Score: ${Math.round(maxScore)}`;
    if (bestTarget === "Slum Snakes" && !context.inGang && context.playerKarma > -54) {
      reason += " (Karma-Farmen für Gang)";
    } else if (bestTarget === "Netburners" && context.hackingLevel < 300) {
      reason += " (Early-Game Hacknet-Boost)";
    } else if (bestTarget === "The Black Hand") {
      reason += " (Hacking-Stats Fokus)";
    }

    return { target: bestTarget, reason };
  }
}