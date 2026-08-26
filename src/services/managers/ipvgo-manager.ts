import { NS } from "@ns";
import { NetburnerHeuristics } from "/domain/ipvgo/heuristics.js";
import { GoBoardSize, GoOpponent } from "/shared/types/ipvgo.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const opponent: GoOpponent = (ns.args[0] as GoOpponent) || "Netburners";
  const boardSize: GoBoardSize = (ns.args[1] as GoBoardSize) || 5;

  while (true) {
    ns.go.resetBoardState(opponent, boardSize);
    let inGame = true;

    while (inGame) {
      // 1. Daten aus der In-Game API abrufen
      const validMoves = ns.go.analysis.getValidMoves();
      const board = ns.go.getBoardState();
      const liberties = ns.go.analysis.getLiberties();

      // 2. Reine Geschäftslogik in der Domain aufrufen
      const move = NetburnerHeuristics.getBestMove(
        validMoves,
        board,
        liberties,
      );

      // 3. Spielaktion ausführen
      if (move) {
        const result = await ns.go.makeMove(move.x, move.y);
        if (result.type === "gameOver") inGame = false;
      } else {
        const result = await ns.go.passTurn();
        if (result.type === "gameOver") inGame = false;
      }

      await ns.sleep(50);
    }

    await ns.sleep(500);
  }
}
