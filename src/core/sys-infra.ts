import { NS } from "@ns";
import { provisionServer } from "/utils/provision";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js";
import { patchState, loadState } from "./state-manager.js";
import { Logger } from "./logger.js";

const TARGET_PROGRAMS = [
  "BruteSSH.exe",
  "FTPCrack.exe",
  "relaySMTP.exe",
  "HTTPWorm.exe",
  "DarkscapeNavigator.exe",
  "SQLInject.exe",
  "Formulas.exe",
] as const;

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Infra", "INFO");
  logger.info("Schlanker Infrastruktur-Manager gestartet.");

  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;

  while (true) {
    const playerMoney = ns.getPlayer().money;
    const currentState = loadState(ns);

    // 🟢 TRIGGER-LOGIK: Starte Singularity-Executor nur, wenn wir flüssig sind
    // 200k für TOR/Programme oder genug Geld für Upgrades laut letzter Messung
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

    // Serverkäufe verwalten (Kein Singularity nötig!)
    await handleServerPurchases(ns, bnMults, freezePservers, logger);

    // UI rendern (Zieht Werte wie CPU-Kerne jetzt gratis aus dem State!)
    printDashboard(ns, freezePservers, currentState);

    await ns.sleep(10000);
  }
}

async function handleServerPurchases(
  ns: NS,
  bnMults: any,
  freezePservers: boolean,
  logger: Logger,
): Promise<void> {
  const maxServers = ns.cloud.getServerLimit();
  if (maxServers === 0 || bnMults.PurchasedServerLimit === 0) return;

  const currentServers = ns.cloud.getServerNames();
  const homeMaxRam = ns.getServerMaxRam("home");
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  const hasEligiblePserv = currentServers.some(
    (s) => ns.getServerMaxRam(s) >= 64,
  );
  const rushSinglePserv =
    hasFormulas &&
    homeMaxRam >= 256 &&
    !hasEligiblePserv &&
    currentServers.length > 0;

  if (freezePservers && !rushSinglePserv) return;

  const maxRam = ns.cloud.getRamLimit();
  let currentBudget = ns.getPlayer().money * 0.9;
  if (currentBudget < 50_000) return;

  let allowedMaxRam = 64;
  if (hasFormulas) allowedMaxRam = maxRam;
  else if (ns.fileExists("SQLInject.exe", "home"))
    allowedMaxRam = Math.min(2048, maxRam);
  else if (ns.fileExists("HTTPWorm.exe", "home")) allowedMaxRam = 512;

  let actionOccurred = true;

  while (actionOccurred) {
    actionOccurred = false;

    let minRam = maxRam;
    let worstServer = "";
    let maxPservRam = 0;
    let bestServer = "";

    for (const server of currentServers) {
      const ram = ns.getServerMaxRam(server);
      if (ram < minRam) {
        minRam = ram;
        worstServer = server;
      }
      if (ram > maxPservRam) {
        maxPservRam = ram;
        bestServer = server;
      }
    }

    let affordableNewRam = 8;
    while (
      affordableNewRam * 2 <= allowedMaxRam &&
      ns.cloud.getServerCost(affordableNewRam * 2) <= currentBudget
    ) {
      affordableNewRam *= 2;
    }
    if (ns.cloud.getServerCost(affordableNewRam) > currentBudget)
      affordableNewRam = 0;

    if (currentServers.length === 0 && affordableNewRam >= 8) {
      const initialRam = Math.min(affordableNewRam, 64);
      if (await buyNewServer(ns, initialRam, maxServers, logger)) {
        currentBudget -= ns.cloud.getServerCost(initialRam);
        actionOccurred = true;
      }
    } else if (rushSinglePserv && bestServer !== "") {
      const nextRam = maxPservRam * 2;
      if (nextRam <= allowedMaxRam) {
        const upgradeCost =
          ns.cloud.getServerCost(nextRam) - ns.cloud.getServerCost(maxPservRam);
        if (currentBudget >= upgradeCost) {
          if (ns.cloud.upgradeServer(bestServer, nextRam)) {
            logger.success(
              `🚀 RUSH-MODUS: ${bestServer} gezielt auf ${ns.format.ram(nextRam)} aufgerüstet.`,
            );
            currentBudget -= upgradeCost;
            actionOccurred = true;
          }
        }
      }
    } else if (currentServers.length < maxServers) {
      if (worstServer !== "" && minRam < affordableNewRam) {
        const nextRam = minRam * 2;
        const upgradeCost =
          ns.cloud.getServerCost(nextRam) - ns.cloud.getServerCost(minRam);

        if (currentBudget >= upgradeCost && nextRam <= allowedMaxRam) {
          if (ns.cloud.upgradeServer(worstServer, nextRam)) {
            logger.info(
              `⚡ Expansion: ${worstServer} auf ${ns.format.ram(nextRam)} hochgestuft.`,
            );
            currentBudget -= upgradeCost;
            actionOccurred = true;
          }
        }
      } else if (affordableNewRam >= 8) {
        if (await buyNewServer(ns, affordableNewRam, maxServers, logger)) {
          currentBudget -= ns.cloud.getServerCost(affordableNewRam);
          actionOccurred = true;
        }
      }
    } else if (worstServer !== "") {
      const nextRam = minRam * 2;
      if (nextRam <= allowedMaxRam) {
        const upgradeCost =
          ns.cloud.getServerCost(nextRam) - ns.cloud.getServerCost(minRam);
        if (currentBudget >= upgradeCost) {
          if (ns.cloud.upgradeServer(worstServer, nextRam)) {
            logger.info(
              `⚡ Flotten-Upgrade: Schwachpunkt ${worstServer} auf ${ns.format.ram(nextRam)} angehoben.`,
            );
            currentBudget -= upgradeCost;
            actionOccurred = true;
          }
        }
      }
    }
  }
}

async function buyNewServer(
  ns: NS,
  ram: number,
  maxServers: number,
  logger: Logger,
): Promise<boolean> {
  const currentServers = ns.cloud.getServerNames();
  let nextFreeNumber = 1;
  let name = "";

  while (nextFreeNumber <= maxServers) {
    const suffix = String(nextFreeNumber).padStart(2, "0");
    const potentialName = `p-serv-${suffix}`;

    if (!currentServers.includes(potentialName)) {
      name = potentialName;
      break;
    }
    nextFreeNumber++;
  }

  if (name === "") name = `p-serv-${Date.now()}`;

  if (ns.cloud.purchaseServer(name, ram)) {
    await provisionServer(ns, name);
    logger.success(
      `🖥️ Neuen Server ins Cluster integriert: ${name} [RAM: ${ns.format.ram(ram)}]`,
    );
    return true;
  }
  return false;
}

function printDashboard(
  ns: NS,
  isHomePrioritized: boolean,
  currentState: any,
): void {
  ns.clearLog();

  const homeMaxRam = ns.getServerMaxRam("home");
  const homeUsedRam = ns.getServerUsedRam("home");

  // 🟢 Kerne werden jetzt gratis aus dem State gelesen!
  const homeCores = currentState?.homeCores ?? 1;

  ns.print(`============================================================`);
  ns.print(` ⚙️  BIT-OS INFRASTRUCTURE MONITOR`);
  ns.print(`============================================================`);
  ns.print(`🏠 HOME COMPUTER`);
  ns.print(
    `   RAM:   ${ns.format.ram(homeMaxRam).padEnd(9)} (Genutzt: ${ns.format.ram(homeUsedRam)})`,
  );
  ns.print(`   CORES: ${homeCores} Kerne`);

  const pServers = ns.cloud.getServerNames();
  const isRushMode = currentState?.isRushModeActive ?? false;

  if (isRushMode) {
    ns.print(
      `   🚦 STRATEGIE: 🚀 BATCHER-RUSH (Fokus auf ein einzelnes 64GB P-Serv)`,
    );
  } else if (isHomePrioritized) {
    ns.print(`   🚦 STRATEGIE: 👑 HOME-PRIORITÄT AKTIV (P-Serv eingefroren)`);
  } else {
    ns.print(`   🚦 STRATEGIE: 💸 Normalbetrieb (Netzwerk-Expansion)`);
  }

  ns.print("------------------------------------------------------------");
  ns.print(`🖥️  CLOUD-NETZWERK (PURCHASED SERVERS)`);

  const currentServers = ns.cloud.getServerNames();
  const maxServers = ns.cloud.getServerLimit();

  if (currentServers.length === 0) {
    ns.print(`   [Keine kaufbaren Server im aktuellen BitNode registriert]`);
  } else {
    currentServers.sort().forEach((server) => {
      const ram = ns.getServerMaxRam(server);
      const used = ns.getServerUsedRam(server);
      const bar =
        "█".repeat(Math.round((used / ram) * 10)) +
        "░".repeat(10 - Math.round((used / ram) * 10));
      ns.print(
        `   • ${server.padEnd(12)} : ${ns.format.ram(ram).padStart(9)}  [${bar}]`,
      );
    });
  }
  ns.print(
    `   Kapazität: ${currentServers.length} / ${maxServers} Server slots genutzt.`,
  );
  ns.print("------------------------------------------------------------");

  ns.print(`💾 SOFTWARE-INVENTAR`);
  let gridLine = "   ";
  for (let i = 0; i < TARGET_PROGRAMS.length; i++) {
    const progName = TARGET_PROGRAMS[i];
    const status = ns.fileExists(progName, "home") ? "✅" : "❌";
    gridLine += `[${status}] ${progName.padEnd(22)}`;

    if ((i + 1) % 2 === 0 || i === TARGET_PROGRAMS.length - 1) {
      ns.print(gridLine);
      gridLine = "   ";
    }
  }
  ns.print(`============================================================`);
}
