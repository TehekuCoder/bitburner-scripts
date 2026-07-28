import { NS } from "@ns";
import { provisionServer } from "../utils/provision.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";

export async function handleServerPurchases(
  ns: NS,
  bnMults: any,
  freezePservers: boolean,
  moneyReserve: number,
  logger: Logger,
): Promise<void> {
  const maxServers = ns.cloud.getServerLimit();
  if (maxServers === 0 || bnMults.PurchasedServerLimit === 0) return;

  // 🛑 HARTER FREEZE: Wenn Home Priorität hat, kaufen/upgraden wir absolut GAR NICHTS.
  if (freezePservers) return;

  const playerMoney = ns.getPlayer().money;
  if (playerMoney <= moneyReserve) return;

  const maxRam = ns.cloud.getRamLimit();

  // --- 1. DYNAMISCHES RAM-LIMIT ERMITTELN ---
  let allowedMaxRam = 64;
  if (ns.fileExists("Formulas.exe", "home")) allowedMaxRam = maxRam;
  else if (ns.fileExists("SQLInject.exe", "home")) allowedMaxRam = Math.min(2048, maxRam);
  else if (ns.fileExists("HTTPWorm.exe", "home")) allowedMaxRam = 512;

  // Budget: 80% des geldfreien Kapitals nach Reserve
  let currentBudget = (playerMoney - moneyReserve) * 0.8;
  if (currentBudget < 100_000) return;

  // --- 2. MINDEST-RAM FÜR NEUKÄUFE ---
  // Kauft keine winzigen 8GB Server, wenn wir 25 Slots haben! Mindestens 32GB/64GB.
  const minNewServerRam = 32;

  // --- 3. EXPANSIONS- SCHLEIFE ---
  let actionOccurred = true;

  while (actionOccurred) {
    actionOccurred = false;

    const updatedServers = ns.cloud.getServerNames();
    let minRam = maxRam;
    let worstServer = "";

    for (const server of updatedServers) {
      const ram = ns.getServerMaxRam(server);
      if (ram < minRam) {
        minRam = ram;
        worstServer = server;
      }
    }

    // Höchstes bezahlbares RAM ermitteln
    let affordableNewRam = minNewServerRam;
    while (
      affordableNewRam * 2 <= allowedMaxRam &&
      ns.cloud.getServerCost(affordableNewRam * 2) <= currentBudget
    ) {
      affordableNewRam *= 2;
    }

    if (ns.cloud.getServerCost(affordableNewRam) > currentBudget) {
      affordableNewRam = 0;
    }

    // Fall A: Noch keine Server ODER Limit noch nicht erreicht
    if (updatedServers.length < maxServers && affordableNewRam >= minNewServerRam) {
      // Wenn das Aufrüsten des schlechtesten Servers günstiger ist als ein Neukauf -> Upgraden
      if (worstServer !== "" && minRam < affordableNewRam) {
        const nextRam = minRam * 2;
        const upgradeCost = ns.cloud.getServerCost(nextRam) - ns.cloud.getServerCost(minRam);

        if (currentBudget >= upgradeCost && nextRam <= allowedMaxRam) {
          if (ns.cloud.upgradeServer(worstServer, nextRam)) {
            logger.info(`⚡ P-Server Upgrade: ${worstServer} -> ${ns.format.ram(nextRam)}`);
            currentBudget -= upgradeCost;
            actionOccurred = true;
          }
        }
      } else {
        // Neuen Server kaufen
        if (await buyNewServer(ns, affordableNewRam, maxServers, logger)) {
          currentBudget -= ns.cloud.getServerCost(affordableNewRam);
          actionOccurred = true;
        }
      }
    } 
    // Fall B: Limit voll (25/25 Server) -> Schwächsten Server aufrüsten
    else if (updatedServers.length >= maxServers && worstServer !== "") {
      const nextRam = minRam * 2;
      if (nextRam <= allowedMaxRam) {
        const upgradeCost = ns.cloud.getServerCost(nextRam) - ns.cloud.getServerCost(minRam);
        if (currentBudget >= upgradeCost) {
          if (ns.cloud.upgradeServer(worstServer, nextRam)) {
            logger.info(`⚡ Flotten-Upgrade: ${worstServer} -> ${ns.format.ram(nextRam)}`);
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
    logger.success(`🖥️ P-Server integriert: ${name} [${ns.format.ram(ram)}]`);
    return true;
  }
  return false;
}