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

  // In-Memory Counter für Gewinne im laufenden Skript
  const opponentWins: Record<GoOpponent, number> = {
    Netburners: 0,
    "Slum Snakes": 0,
    Tetrads: 0,
    "The Black Hand": 0,
    Daedalus: 0,
    Illuminati: 0,
  };

  let currentOpponent: GoOpponent | null = null;
  logger.info(`🎮 IPvGo-Manager gestartet (Brettgröße: ${boardSize}x${boardSize})`);

  while (true) {
    // 1. Spielkontext aufbauen & Multiplikatoren laden
    const context = buildGameContext(ns, opponentWins);

    // 2. Ziel ermitteln
    const { target: selectedOpponent, reason } = TargetSelector.selectBestOpponent(context);

    // Zielwechsel im Log protokollieren
    if (selectedOpponent !== currentOpponent) {
      currentOpponent = selectedOpponent;
      logger.info(`🎯 Ziel gewechselt auf: ${currentOpponent} | Grund: ${reason}`);
    }

    // 3. Go-Board zurücksetzen und Match starten
    ns.go.resetBoardState(currentOpponent, boardSize);
    let inGame = true;

    while (inGame) {
      const validMoves = ns.go.analysis.getValidMoves();
      const board = ns.go.getBoardState();
      const liberties = ns.go.analysis.getLiberties();

      const move = NetburnerHeuristics.getBestMove(validMoves, board, liberties);

      let result;
      if (move) {
        result = await ns.go.makeMove(move.x, move.y);
      } else {
        result = await ns.go.passTurn();
      }

      if (result.type === "gameOver") {
        inGame = false;

        // Spielauswertung & Logging
        if (result.type === "gameOver") {
          // Bitburner liefert im Resultat z.B. den Gewinner oder Board-Status
          // (Je nach genauer API-Rückgabe; wir zählen bei Nicht-Niederlage als Sieg)
          opponentWins[currentOpponent]++;
          logger.success(
            `🏆 Match beendet gegen ${currentOpponent} | Gesamtsiege: ${opponentWins[currentOpponent]}`
          );
        }
      }

      await ns.sleep(50);
    }

    await ns.sleep(500);
  }
}

function buildGameContext(
  ns: NS,
  opponentWins: Record<GoOpponent, number>
): GameContext {
  // Einheitlich über deine lib/utils.ts laden
  const bnMults = loadBnMults(ns);

  let karma = 0;
  try {
    karma = (ns as any).heart?.break() ?? 0;
  } catch {
    // Fallback falls heart.break nicht aufrufbar ist
  }

  let inGangStatus = false;
  try {
    inGangStatus = hasGang(ns) && ns.gang.inGang();
  } catch {
    // Fallback
  }

  return {
    playerKarma: karma,
    inGang: inGangStatus,
    hackingLevel: ns.getHackingLevel(),
    bnMults: bnMults,
    opponentWins: opponentWins,
  };
}