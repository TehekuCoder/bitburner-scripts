import { NS } from "@ns";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js";
import { loadState } from "./state-manager.js";
import { Logger } from "./logger.js";
import { handleServerPurchases } from "../lib/pserv-manager.js"; // 🟢 Ausgelagert
import { printDashboard } from "../lib/infra-ui.js";            // 🟢 Ausgelagert

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Infra", "INFO");
  logger.info("Schlanker Infrastruktur-Manager gestartet.");

  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;

  while (true) {
    const playerMoney = ns.getPlayer().money;
    const currentState = loadState(ns);

    // TRIGGER-LOGIK: Starte Singularity-Executor nur, wenn wir flüssig sind
    const moneyReserve = currentState?.moneyReserve || 500_000;
    const shouldRunSing = playerMoney >= 200_000 || playerMoney >= moneyReserve;

    if (
      shouldRunSing &&
      !ns.isRunning("/utils/infra-sing-executor.js", "home")
    ) {
      ns.run("/utils/infra-sing-executor.js", 1);
    }

    // Hole den eingefrorenen Status direkt und sicher aus dem State
    const freezePservers = currentState?.isHomePrioritized ?? false;

    // Serverkäufe verwalten via Library-Modul
    await handleServerPurchases(ns, bnMults, freezePservers, logger);

    // UI rendern via Library-Modul
    printDashboard(ns, freezePservers, currentState);

    await ns.sleep(10000);
  }
}