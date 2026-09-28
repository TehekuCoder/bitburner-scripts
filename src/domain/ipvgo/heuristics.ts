import { GoPoint } from "/shared/types/ipvgo.js";

export class NetburnerHeuristics {
  public static getBestMove(
    validMoves: boolean[][],
    board: string[],
    liberties: number[][],
    myColor: "X" | "O" = "O",
  ): GoPoint | null {
    const size = validMoves.length;
    let bestMove: GoPoint | null = null;
    let highestScore = -Infinity;

    const enemyColor = myColor === "O" ? "X" : "O";

    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        if (!validMoves[x][y]) continue;

        const score = this.evaluateMove(x, y, size, board, liberties, myColor, enemyColor);
        if (score > highestScore) {
          highestScore = score;
          bestMove = { x, y };
        }
      }
    }

    // Passen (null), wenn kein Zug einen positiven Wert liefert
    if (highestScore <= 0) return null;

    return bestMove;
  }

  private static evaluateMove(
    x: number,
    y: number,
    size: number,
    board: string[],
    liberties: number[][],
    myColor: string,
    enemyColor: string,
  ): number {
    let score = 0;

    // 1. Zentrumskontrolle (besonders auf 5x5 und 7x7)
    const center = Math.floor(size / 2);
    const distToCenter = Math.abs(x - center) + Math.abs(y - center);
    score += (size - distToCenter) * 20;

    const neighbors = this.getNeighbors(x, y, size);
    let emptyCount = 0;
    let enemyAtariCount = 0;
    let ownAtariCount = 0;
    let ownNeighbors = 0;
    let routerNeighbors = 0;

    for (const [nx, ny] of neighbors) {
      const cell = board[nx]?.[ny];
      const lib = liberties[nx]?.[ny] ?? 0;

      if (cell === ".") {
        emptyCount++;
      } else if (cell === "#") {
        routerNeighbors++;
      } else if (cell === enemyColor) {
        if (lib === 1) enemyAtariCount++;
      } else if (cell === myColor) {
        ownNeighbors++;
        if (lib === 1) ownAtariCount++;
      }
    }

    // 2. Taktische Prioritäten (Töten > Retten)
    if (enemyAtariCount > 0) score += 2000; // Gegnerischen Stein schlagen
    if (ownAtariCount > 0) score += 1200;   // Eigene Steine in Atari retten

    // 3. Freiheiten belohnen
    score += emptyCount * 30;

    // 4. Schutz vor Augen-Zusetzen (Eigenes Auge nicht füllen)
    const playableNeighbors = neighbors.length - routerNeighbors;
    if (emptyCount === 0 && ownNeighbors === playableNeighbors) {
      score -= 2000; // Starker Abzug: Niemals eigene Augen zusetzen!
    }

    return score;
  }

  private static getNeighbors(
    x: number,
    y: number,
    size: number,
  ): [number, number][] {
    const res: [number, number][] = [];
    if (x > 0) res.push([x - 1, y]);
    if (x < size - 1) res.push([x + 1, y]);
    if (y > 0) res.push([x, y - 1]);
    if (y < size - 1) res.push([x + 1, y]);
    return res;
  }
}