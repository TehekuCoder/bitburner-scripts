import { NS } from "@ns";
import { NetburnerHeuristics } from "/domain/ipvgo/heuristics.js";
import { TargetSelector, GameContext } from "/domain/ipvgo/target-selector.js";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { loadBnMults, hasGang } from "/lib/utils.js";
import { GoBoardSize, GoOpponent } from "/shared/types/ipvgo.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const logger = new LoggerClient(ns, "IPvGoManager");
  const boardSize: GoBoardSize = (ns.args[0] as GoBoardSize) || 5;

  // Siege direkt aus den tatsächlichen IPvGo-Statistiken der API initialisieren
  const opponentWins: Record<GoOpponent, number> = {
    Netburners: getInitialWins(ns, "Netburners"),
    "Slum Snakes": getInitialWins(ns, "Slum Snakes"),
    Tetrads: getInitialWins(ns, "Tetrads"),
    "The Black Hand": getInitialWins(ns, "The Black Hand"),
    Daedalus: 0,
    Illuminati: 0,
  };

  let currentOpponent: GoOpponent | null = null;
  logger.info(
    `🎮 IPvGo-Manager gestartet (Brettgröße: ${boardSize}x${boardSize})`,
  );

  while (true) {
    const context = buildGameContext(ns, opponentWins);
    const { target: selectedOpponent, reason } =
      TargetSelector.selectBestOpponent(context);

    if (selectedOpponent !== currentOpponent) {
      currentOpponent = selectedOpponent;
      logger.info(
        `🎯 Ziel gewechselt auf: ${currentOpponent} | Grund: ${reason}`,
      );
    }

    ns.go.resetBoardState(currentOpponent, boardSize);
    let inGame = true;

    while (inGame) {
      const validMoves = ns.go.analysis.getValidMoves();
      const board = ns.go.getBoardState();
      const liberties = ns.go.analysis.getLiberties();

      const move = NetburnerHeuristics.getBestMove(
        validMoves,
        board,
        liberties,
      );

      const result = move
        ? await ns.go.makeMove(move.x, move.y)
        : await ns.go.passTurn();

      if (result.type === "gameOver") {
        inGame = false;

        // Nur bei tatsächlichem Gewinner den Zähler hochzählen
        // In Bitburner IPvGo signalisiert (result as any).winner meist den Sieger
        const isWin =
          (result as any).winner === "Black" ||
          (result as any).winner === ns.go.getOpponent();

        if (isWin) {
          opponentWins[currentOpponent]++;
          logger.success(
            `🏆 Match GEWONNEN gegen ${currentOpponent} | Gesamtsiege (Session): ${opponentWins[currentOpponent]}`,
          );
        } else {
          logger.warn(`❌ Match verloren gegen ${currentOpponent}`);
        }
      }

      await ns.sleep(30);
    }

    await ns.sleep(300);
  }
}

function getInitialWins(ns: NS, opponent: GoOpponent): number {
  try {
    // Versucht echte Sieganzahl aus Bitburner API zu lesen
    const stats =
      (ns.go as any).getGameState?.() || (ns.go as any).getStats?.();
    return stats?.wins ?? 0;
  } catch {
    return 0;
  }
}

function buildGameContext(
  ns: NS,
  opponentWins: Record<GoOpponent, number>,
): GameContext {
  const bnMults = loadBnMults(ns);

  let karma = 0;
  try {
    karma = (ns as any).heart?.break() ?? 0;
  } catch {}

  let inGangStatus = false;
  try {
    inGangStatus = hasGang(ns) && ns.gang.inGang();
  } catch {}

  return {
    playerKarma: karma,
    inGang: inGangStatus,
    hackingLevel: ns.getHackingLevel(),
    bnMults: bnMults,
    opponentWins: opponentWins,
  };
}
