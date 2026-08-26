import { GoPoint } from "/shared/types/ipvgo.js";

export class NetburnerHeuristics {
  /**
   * Evaluiert das Spielfeld basierend auf den Rohdaten und gibt den besten Zug zurück.
   */
  public static getBestMove(
    validMoves: boolean[][],
    board: string[],
    liberties: number[][]
  ): GoPoint | null {
    const size = validMoves.length;
    let bestMove: GoPoint | null = null;
    let highestScore = -Infinity;

    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        if (!validMoves[x][y]) continue;

        const score = this.evaluateMove(x, y, size, board, liberties);
        if (score > highestScore) {
          highestScore = score;
          bestMove = { x, y };
        }
      }
    }

    // Wenn alle Züge negativ bewertet wurden, ist Passen (null) die beste Wahl
    if (highestScore < 0) return null;

    return bestMove;
  }

  private static evaluateMove(
    x: number,
    y: number,
    size: number,
    board: string[],
    liberties: number[][]
  ): number {
    let score = 0;

    // 1. Zentrumskontrolle (Mitte auf 5x5 präferieren)
    const center = Math.floor(size / 2);
    const distToCenter = Math.abs(x - center) + Math.abs(y - center);
    score += (size - distToCenter) * 15;

    const neighbors = this.getNeighbors(x, y, size);
    let emptyCount = 0;
    let enemyAtariCount = 0;
    let ownAtariCount = 0;
    let ownNeighbors = 0;

    for (const [nx, ny] of neighbors) {
      const cell = board[nx]?.[ny];
      const lib = liberties[nx]?.[ny] ?? 0;

      if (cell === ".") {
        emptyCount++;
      } else if (cell === "X") {
        if (lib === 1) enemyAtariCount++; // Gegnerischer Stein in Atari
      } else if (cell === "O") {
        ownNeighbors++;
        if (lib === 1) ownAtariCount++;   // Eigener Stein in Atari
      }
    }

    // 2. Taktische Prioritäten
    if (enemyAtariCount > 0) score += 1000; // Gegner schlagen
    if (ownAtariCount > 0) score += 800;    // Eigene Steine retten

    // 3. Freiheiten belohnen
    score += emptyCount * 25;

    // 4. Eigene Augen nicht zusetzen
    if (emptyCount === 0 && ownNeighbors === neighbors.length) {
      score -= 500;
    }

    return score;
  }

  private static getNeighbors(x: number, y: number, size: number): [number, number][] {
    const res: [number, number][] = [];
    if (x > 0) res.push([x - 1, y]);
    if (x < size - 1) res.push([x + 1, y]);
    if (y > 0) res.push([x, y - 1]);
    if (y < size - 1) res.push([x, y + 1]);
    return res;
  }
}