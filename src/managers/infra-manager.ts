import { NS } from "@ns";
import { printDashboard } from "ui/infra-ui.js";
import { DEFAULT_MULTIPLIERS } from "/lib/constants";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { handleServerPurchases } from "/lib/pserv-manager";
import { loadBnMults, loadFinanceState } from "/lib/state.js";

export async function main(ns: NS): Promise<void> {
  void ns.cloud.getServerCost;

  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.ui.setTailTitle("Infrastruktur");
  ns.ui.resizeTail(580, 500);

  const logger = new Logger(ns, "Infra");
  logger.info("Infrastruktur-Manager gestartet.");

  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;

  while (true) {
    const playerMoney = ns.getPlayer().money;
    const financeState = loadFinanceState(ns);
    const homeMaxRam = ns.getServerMaxRam("home");

    // 🎯 RULE: Home-RAM hat absolute Priorität bis 128 GB.
    // Erst wenn Home mindestens 128 GB hat, erlauben wir P-Server-Käufe!
    const isHomeUnderpowered = homeMaxRam < 128;
    const freezePservers =
      isHomeUnderpowered ||
      financeState?.isHomePrioritized ||
      (financeState?.moneyReserve ?? 0) > 0;

    // Singularity Executor anstoßen (für Home-RAM Upgrades & Programmkäufe)
    const moneyReserve = financeState?.moneyReserve || 0;
    const dynamicAvailable = playerMoney - moneyReserve;
    const shouldRunSing = dynamicAvailable >= 200_000 || playerMoney >= 500_000;

    if (
      shouldRunSing &&
      !ns.scriptRunning("/utils/infra-sing-executor.js", "home")
    ) {
      ns.run("/utils/infra-sing-executor.js", 1);
    }

    // P-Server Käufe verwalten
    await handleServerPurchases(
      ns,
      bnMults,
      freezePservers,
      moneyReserve,
      logger,
    );

    // UI rendern
    const uiState = {
      ...(financeState || {}),
      homeCores: ns.getServer("home").cpuCores,
      isHomeUnderpowered,
    };
    printDashboard(ns, freezePservers, uiState);

    await ns.sleep(1000);
  }
}