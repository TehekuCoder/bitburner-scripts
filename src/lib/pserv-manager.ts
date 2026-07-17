// src/lib/pserv-manager.ts

import { NS } from "@ns";
import { provisionServer } from "../utils/provision.js"; 
import { Logger } from "../core/logger.js";

export async function handleServerPurchases(
  ns: NS,
  bnMults: any,
  freezePservers: boolean,
  moneyReserve: number, // 🟢 Neu eingepflegt
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

  // Wenn P-Server eingefroren sind und wir nicht im lategame "Rush" sind, sofort stoppen
  if (freezePservers && !rushSinglePserv) return;

  const maxRam = ns.cloud.getRamLimit();
  const playerMoney = ns.getPlayer().money;

  // 🛑 CRITICAL FIX: Absoluter finanzieller Schutzwall
  if (playerMoney <= moneyReserve) return; 
  
  // Das Budget ist 90% von dem Geld, das uns nach Abzug der Reserve FREI zur Verfügung steht
  let currentBudget = (playerMoney - moneyReserve) * 0.9;
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

    // Frische Serverliste innerhalb der Schleife abfragen, falls sich Daten geändert haben
    const updatedServers = ns.cloud.getServerNames();

    for (const server of updatedServers) {
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

    if (updatedServers.length === 0 && affordableNewRam >= 8) {
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
    } else if (updatedServers.length < maxServers) {
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