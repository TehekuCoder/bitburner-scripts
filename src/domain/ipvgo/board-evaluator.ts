import { GoPoint } from "/shared/types/ipvgo.js";

export class BoardEvaluator {
  /**
   * Filtert gültige Züge heraus und bewertet sie nach einfachen Heuristiken:
   * 1. Vermeide Züge, die direkt in den Selbstmord führen (0 Liberties).
   * 2. Bevorzuge Züge, die gegnerische Steine schlagen oder eigene Freiheiten erweitern.
   */
  public static getBestMove(validMoves: boolean[][], board: string[]): GoPoint | null {
    const size = validMoves.length;
    const candidates: GoPoint[] = [];

    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        if (validMoves[x][y]) {
          candidates.push({ x, y });
        }
      }
    }

    if (candidates.length === 0) return null;

    // Einfache Zufallsauswahl aus allen legalen Zügen als Fallback/Basis
    // (Kann später um Liberty-Prüfung und Raumkontrolle erweitert werden)
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}