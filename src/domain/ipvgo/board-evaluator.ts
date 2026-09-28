import { GoPoint } from "/shared/types/ipvgo.js";

export class BoardEvaluator {
  public static getValidMoveList(validMoves: boolean[][]): GoPoint[] {
    const size = validMoves.length;
    const candidates: GoPoint[] = [];

    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        if (validMoves[x][y]) {
          candidates.push({ x, y });
        }
      }
    }

    return candidates;
  }
}