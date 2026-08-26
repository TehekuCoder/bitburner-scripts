import { NS } from "@ns";
import { BoardEvaluator } from "/domain/ipvgo/board-evaluator.js";
import { GoBoardSize, GoOpponent } from "/shared/types/ipvgo.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const opponent: GoOpponent = (ns.args[0] as GoOpponent) || "Netburners";
  const boardSize: GoBoardSize = (ns.args[1] as GoBoardSize) || 5;

  while (true) {
    // Neues Spiel gegen das gewählte Ziel aufsetzen
    ns.go.resetBoardState(opponent, boardSize);
    let inGame = true;

    while (inGame) {
      // getValidMoves() liegt jetzt unter ns.go.analysis
      const validMoves = ns.go.analysis.getValidMoves();
      const board = ns.go.getBoardState();

      // Ermittlung des besten Zuges über die Domain-Logik
      const move = BoardEvaluator.getBestMove(validMoves, board);

      if (move) {
        const result = await ns.go.makeMove(move.x, move.y);
        if (result.type === "gameOver") inGame = false;
      } else {
        const result = await ns.go.passTurn();
        if (result.type === "gameOver") inGame = false;
      }

      await ns.sleep(50);
    }

    await ns.sleep(500); // Pause vor der nächsten Runde
  }
}