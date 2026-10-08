import { NS } from "@ns";
import { NetburnerHeuristics } from "/domain/ipvgo/heuristics.js";
import { TargetSelector, GameContext } from "/domain/ipvgo/target-selector.js";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { loadBnMults, hasGang, hasBladeburner } from "/lib/utils.js";
import { GoBoardSize, GoOpponent } from "/shared/types/ipvgo.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const logger = new LoggerClient(ns, "IPvGoManager");
  const boardSize = (ns.args[0] as GoBoardSize) || 5;

  // Initialisierung der Siege über die Bitburner 3.0 API (0 GB RAM)
  const opponentWins = getInitialWins(ns);

  let currentOpponent: GoOpponent | null = null;
  logger.info(
    `🎮 IPvGo-Manager gestartet (Bitburner 3.0 | Brettgröße: ${boardSize}x${boardSize})`,
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
      let result: {
        type: "move" | "pass" | "gameOver";
        x: number | null;
        y: number | null;
      };

      const validMoves = ns.go.analysis.getValidMoves();
      const board = ns.go.getBoardState();
      const liberties = ns.go.analysis.getLiberties();
      const playerColor = "X";

      const move = NetburnerHeuristics.getBestMove(
        validMoves,
        board,
        liberties,
        playerColor,
      );

      // SF14.2 Cheat-Anwendung bei 100% Erfolgschance
      const canCheat = isCheatSafe(ns);

      if (canCheat && move) {
        const secondMove = NetburnerHeuristics.getSecondBestMove(
          validMoves,
          board,
          liberties,
          move,
          playerColor,
        );

        if (secondMove) {
          result = await ns.go.cheat.playTwoMoves(
            move.x,
            move.y,
            secondMove.x,
            secondMove.y,
          );
        } else {
          result = await ns.go.makeMove(move.x, move.y);
        }
      } else if (move) {
        result = await ns.go.makeMove(move.x, move.y);
      } else {
        result = await ns.go.passTurn();
      }

      if (result.type === "gameOver") {
        inGame = false;

        // Aktualisierung der Siegeszahlen direkt aus ns.go.analysis.getStats() (0 GB RAM)
        const stats = ns.go.analysis.getStats();
        if (currentOpponent && stats[currentOpponent]) {
          opponentWins[currentOpponent] = stats[currentOpponent]!.wins;
        }

        logger.info(
          `🏁 Match beendet gegen ${currentOpponent} | Siege (Gesamt): ${
            opponentWins[currentOpponent] ?? 0
          }`,
        );
      }

      await ns.sleep(30);
    }

    await ns.sleep(300);
  }
}

/**
 * Liest die Siege aller Gegner direkt über die 0-RAM API ns.go.analysis.getStats().
 */
function getInitialWins(ns: NS): Record<GoOpponent, number> {
  const wins: Record<GoOpponent, number> = {
    Netburners: 0,
    "Slum Snakes": 0,
    Tetrads: 0,
    "The Black Hand": 0,
    Daedalus: 0,
    Illuminati: 0,
    "????????????": 0,
    "No AI": 0,
  };

  try {
    const stats = ns.go.analysis.getStats();
    for (const [opp, data] of Object.entries(stats)) {
      if (data && opp in wins) {
        wins[opp as GoOpponent] = data.wins;
      }
    }
  } catch {
    // Fallback falls Methode nicht verfügbar ist
  }

  return wins;
}

/**
 * Prüft, ob SF14.2 Cheats risikolos (100% Erfolgschance) genutzt werden können.
 */
function isCheatSafe(ns: NS): boolean {
  try {
    return ns.go.cheat && ns.go.cheat.getCheatSuccessChance() >= 1.0;
  } catch {
    return false;
  }
}

function buildGameContext(
  ns: NS,
  opponentWins: Record<GoOpponent, number>,
): GameContext {
  const bnMults = loadBnMults(ns);

  let karma = 0;
  try {
    karma = (ns as any).heart?.break() ?? ns.getPlayer().karma ?? 0;
  } catch {}

  let inGangStatus = false;
  try {
    inGangStatus = hasGang(ns) && ns.gang.inGang();
  } catch {}

  let inBladeburnerStatus = false;
  let bbRank = 0;
  try {
    if (hasBladeburner(ns) && ns.bladeburner.inBladeburner()) {
      inBladeburnerStatus = true;
      bbRank = ns.bladeburner.getRank();
    }
  } catch {}

  return {
    playerKarma: karma,
    inGang: inGangStatus,
    inBladeburner: inBladeburnerStatus,
    bladeburnerRank: bbRank,
    hackingLevel: ns.getHackingLevel(),
    bnMults: bnMults,
    opponentWins: opponentWins,
  };
}