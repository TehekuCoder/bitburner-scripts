import { NS } from "@ns";
import { printDashboard } from "ui/infra-ui.js";
import { DEFAULT_MULTIPLIERS } from "/lib/constants";
import { Logger } from "/lib/logger";
import { handleServerPurchases } from "/lib/pserv-manager";
import { loadBnMults, loadState } from "/lib/state";

export async function main(ns: NS): Promise<void> {
  // 🟢 DUMMY-REFERENZ: Zwingt den AST-Parser dazu, ns.cloud.getServerCost (0.25 GB)
  // sofort einzuberechnen (erhöht die Statische Zuweisung von 5.40 GB auf 5.65 GB).
  void ns.cloud.getServerCost;

  ns.disableLog("ALL");

  ns.ui.openTail();
  ns.ui.setTailTitle("Infrastruktur");
  ns.ui.resizeTail(580, 500);

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
    const freezePservers =
      currentState?.isHomePrioritized || (moneyReserve > 0 && homeMaxRam < 256);

    // Serverkäufe verwalten - Jetzt mit Übergabe der moneyReserve!
    await handleServerPurchases(
      ns,
      bnMults,
      freezePservers,
      moneyReserve,
      logger,
    );

    // UI rendern via Library-Modul
    printDashboard(ns, freezePservers, currentState);

    await ns.sleep(10000);
  }
}