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
  let lastUpgradeToast = 0;

  while (true) {
    const playerMoney = ns.getPlayer().money;
    const financeState = loadFinanceState(ns);
    const homeMaxRam = ns.getServerMaxRam("home");

    const isHomeUnderpowered = homeMaxRam < 256;
    const freezePservers =
      isHomeUnderpowered ||
      financeState?.isHomePrioritized ||
      (financeState?.moneyReserve ?? 0) > 0;

    // 💡 Benachrichtigung für manuelles Upgrade (falls SF4 noch nicht aktiv ist)
    if (ns.singularity !== undefined) {
      const ramCost = ns.singularity.getUpgradeHomeRamCost();
      const now = Date.now();
      
      if (
        isHomeUnderpowered &&
        playerMoney >= ramCost &&
        now - lastUpgradeToast > 60_000
      ) {
        ns.toast(
          `💡 Home-RAM Upgrade verfügbar (${ns.format.ram(homeMaxRam * 2)}) für $${ns.format.number(ramCost)}!`,
          "info",
          10000,
        );
        logger.info(
          `💡 Geld für Home-RAM Upgrade vorhanden. Kaufe es in Alpha Ent. / City Terminal!`,
        );
        lastUpgradeToast = now;
      }
    }

    // P-Server Käufe verwalten
    await handleServerPurchases(
      ns,
      bnMults,
      freezePservers,
      financeState?.moneyReserve || 0,
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