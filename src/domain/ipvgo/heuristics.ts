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
    const moveCount = this.countStonesOnBoard(board);

    // 1. ERÖFFNUNG (5x5 / 7x7): Zentrum (Tengen) bevorzugen
    const center = Math.floor(size / 2);
    if (moveCount < 2 && validMoves[center][center]) {
      return { x: center, y: center };
    }

    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        if (!validMoves[x][y]) continue;

        const score = this.evaluateMoveAdvanced(
          x,
          y,
          size,
          board,
          liberties,
          myColor,
          enemyColor,
        );

        if (score > highestScore) {
          highestScore = score;
          bestMove = { x, y };
        }
      }
    }

    if (highestScore <= -5000) return null;
    return bestMove;
  }

  /**
   * Ermittelt den zweitbesten Zug auf dem Brett für Doppelzüge via SF14.2 Cheat (`ns.go.cheat.playTwoMoves`).
   */
  public static getSecondBestMove(
    validMoves: boolean[][],
    board: string[],
    liberties: number[][],
    firstMove: GoPoint,
    myColor: "X" | "O" = "O",
  ): GoPoint | null {
    const size = validMoves.length;
    let secondBestMove: GoPoint | null = null;
    let highestScore = -Infinity;

    const enemyColor = myColor === "O" ? "X" : "O";

    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        // Ersten Zug überspringen
        if (x === firstMove.x && y === firstMove.y) continue;
        if (!validMoves[x][y]) continue;

        const score = this.evaluateMoveAdvanced(
          x,
          y,
          size,
          board,
          liberties,
          myColor,
          enemyColor,
        );

        if (score > highestScore) {
          highestScore = score;
          secondBestMove = { x, y };
        }
      }
    }

    if (highestScore <= -5000) return null;
    return secondBestMove;
  }

  private static evaluateMoveAdvanced(
    x: number,
    y: number,
    size: number,
    board: string[],
    liberties: number[][],
    myColor: string,
    enemyColor: string,
  ): number {
    let score = 0;
    const neighbors = this.getNeighbors(x, y, size);

    let emptyNeighbors = 0;
    let ownNeighbors = 0;
    let enemyNeighbors = 0;
    let routerNeighbors = 0;

    let capturesEnemyStones = 0;
    let savesOwnAtari = 0;

    for (const [nx, ny] of neighbors) {
      const cell = board[nx]?.[ny];
      const lib = liberties[nx]?.[ny] ?? 0;

      if (cell === ".") {
        emptyNeighbors++;
      } else if (cell === "#") {
        routerNeighbors++;
      } else if (cell === enemyColor) {
        enemyNeighbors++;
        if (lib === 1) {
          capturesEnemyStones += 10;
        }
      } else if (cell === myColor) {
        ownNeighbors++;
        if (lib === 1) {
          savesOwnAtari += 5;
        }
      }
    }

    // TAKTISCHE BEWERTUNG
    if (capturesEnemyStones > 0) {
      score += 5000 + capturesEnemyStones * 500;
    }

    if (savesOwnAtari > 0) {
      score += 3000 + savesOwnAtari * 300;
    }

    const estimatedPostMoveLiberties = this.estimatePostMoveLiberties(
      x,
      y,
      neighbors,
      board,
      liberties,
      myColor,
      enemyColor,
    );

    // Self-Atari Ausschluss
    if (estimatedPostMoveLiberties === 1 && capturesEnemyStones === 0) {
      return -10000;
    }

    score += estimatedPostMoveLiberties * 150;

    // Zentrums-Kontrolle
    const center = Math.floor(size / 2);
    const distToCenter = Math.abs(x - center) + Math.abs(y - center);
    score += (size - distToCenter) * 40;

    // Schutz vor Augenschluss
    const playableNeighbors = neighbors.length - routerNeighbors;
    if (emptyNeighbors === 0 && ownNeighbors === playableNeighbors) {
      return -8000;
    }

    // Ecken-Malus
    if ((x === 0 || x === size - 1) && (y === 0 || y === size - 1)) {
      score -= 100;
    }

    return score;
  }

  private static estimatePostMoveLiberties(
    x: number,
    y: number,
    neighbors: [number, number][],
    board: string[],
    liberties: number[][],
    myColor: string,
    enemyColor: string,
  ): number {
    let totalLiberties = 0;
    const countedEmpty = new Set<string>();

    for (const [nx, ny] of neighbors) {
      const cell = board[nx]?.[ny];
      if (cell === ".") {
        countedEmpty.add(`${nx},${ny}`);
      } else if (cell === myColor) {
        totalLiberties += Math.max(0, (liberties[nx]?.[ny] ?? 1) - 1);
      } else if (cell === enemyColor && liberties[nx]?.[ny] === 1) {
        countedEmpty.add(`${nx},${ny}`);
      }
    }

    return totalLiberties + countedEmpty.size;
  }

  private static countStonesOnBoard(board: string[]): number {
    let count = 0;
    for (const row of board) {
      for (const char of row) {
        if (char === "X" || char === "O") count++;
      }
    }
    return count;
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
    if (y < size - 1) res.push([x, y + 1]);
    return res;
  }
}