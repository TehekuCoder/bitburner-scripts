import { NS } from "@ns";
import { loadBnMults } from "../lib/state.js";
import { loadState } from "./state-manager.js";
import { Logger } from "./logger.js";
import { handleServerPurchases } from "../lib/pserv-manager.js"; 
import { printDashboard } from "../lib/infra-ui.js";  
import { DEFAULT_MULTIPLIERS } from "/lib/constants.js";          

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Infra", "INFO");
  logger.info("Schlanker Infrastruktur-Manager gestartet.");

  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;

  while (true) {
    const playerMoney = ns.getPlayer().money;
    const currentState = loadState(ns);

    // TRIGGER-LOGIK: Berechne verfügbares Einkommen NACH Abzug der Reserve
    const moneyReserve = currentState?.moneyReserve || 0;
    const dynamicAvailable = playerMoney - moneyReserve;
    const shouldRunSing = dynamicAvailable >= 200_000 || playerMoney >= 500_000;

    if (
      shouldRunSing &&
      !ns.scriptRunning("/utils/infra-sing-executor.js", "home")
    ) {
      ns.run("/utils/infra-sing-executor.js", 1);
    }

    // 🛑 AUTOMATISCHER SCHUTZ: Friere P-Server ein, wenn eine Upgrade-Reserve für Home aktiv ist
    const homeMaxRam = ns.getServerMaxRam("home");
    const freezePservers = currentState?.isHomePrioritized || (moneyReserve > 0 && homeMaxRam < 256);

    // Serverkäufe verwalten - Jetzt mit Übergabe der moneyReserve!
    await handleServerPurchases(ns, bnMults, freezePservers, moneyReserve, logger);

    // UI rendern via Library-Modul
    printDashboard(ns, freezePservers, currentState);

    await ns.sleep(10000);
  }
}