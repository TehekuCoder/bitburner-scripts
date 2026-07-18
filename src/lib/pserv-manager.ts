// src/lib/pserv-manager.ts

import { NS } from "@ns";
import { provisionServer } from "../utils/provision.js";
import { Logger } from "../core/logger.js";

export async function handleServerPurchases(
  ns: NS,
  bnMults: any,
  freezePservers: boolean,
  moneyReserve: number,
  logger: Logger,
): Promise<void> {
  const maxServers = ns.cloud.getServerLimit();
  if (maxServers === 0 || bnMults.PurchasedServerLimit === 0) return;

  const currentServers = ns.cloud.getServerNames();
  const maxRam = ns.cloud.getRamLimit();
  const playerMoney = ns.getPlayer().money;

  // --- 1. DYNAMISCHES RAM-LIMIT ERMITTELN (Zuerst ausführen!) ---
  let allowedMaxRam = 64;
  if (ns.fileExists("Formulas.exe", "home")) allowedMaxRam = maxRam;
  else if (ns.fileExists("SQLInject.exe", "home"))
    allowedMaxRam = Math.min(2048, maxRam);
  else if (ns.fileExists("HTTPWorm.exe", "home")) allowedMaxRam = 512;

  // --- 2. INTELLIGENTER FREEZE-CHECK (SCHNÄPPCHEN-FINDER) ---
  if (freezePservers) {
    // Wenn ein Upgrade weniger als 2% des Gesamtvermögens kostet, ignorieren wir den Freeze.
    // Das treibt den Home-Server-Sprint durch mehr Netzwerkleistung sogar an!
    let hasCheapUpgrade = false;

    for (const server of currentServers) {
      const currentRam = ns.getServerMaxRam(server);
      if (currentRam * 2 <= allowedMaxRam) {
        const cost =
          ns.cloud.getServerCost(currentRam * 2) -
          ns.cloud.getServerCost(currentRam);
        if (cost < playerMoney * 0.02) {
          hasCheapUpgrade = true;
          break;
        }
      }
    }
    // Wenn kein Schnäppchen existiert und wir eingefroren sind -> Abbruch
    if (!hasCheapUpgrade) return;
  }

  // --- 3. FINANZIELLER SCHUTZWALL & BUDGET ---
  if (playerMoney <= moneyReserve) return;

  // Das Budget beträgt 90% des Kapitals, das NACH Abzug der Reserve frei verfügbar ist
  let currentBudget = (playerMoney - moneyReserve) * 0.9;
  if (currentBudget < 50_000) return;

  // --- 4. EXPANSIONS- UND UPGRADE-SCHLEIFE ---
  let actionOccurred = true;

  while (actionOccurred) {
    actionOccurred = false;

    // Frische Serverliste innerhalb der Schleife abfragen, falls Server gekauft/aufgerüstet wurden
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

    // Berechnen, welches maximale RAM wir uns leisten können
    let affordableNewRam = 8;
    while (
      affordableNewRam * 2 <= allowedMaxRam &&
      ns.cloud.getServerCost(affordableNewRam * 2) <= currentBudget
    ) {
      affordableNewRam *= 2;
    }
    if (ns.cloud.getServerCost(affordableNewRam) > currentBudget) {
      affordableNewRam = 0;
    }

    // Fall A: Wir besitzen noch überhaupt keine Server
    if (updatedServers.length === 0 && affordableNewRam >= 8) {
      const initialRam = Math.min(affordableNewRam, 64);
      if (await buyNewServer(ns, initialRam, maxServers, logger)) {
        currentBudget -= ns.cloud.getServerCost(initialRam);
        actionOccurred = true;
      }
    }
    // Fall B: Wir haben das Server-Limit noch nicht erreicht
    else if (updatedServers.length < maxServers) {
      // Wenn ein Upgrade des schlechtesten Servers sinnvoller ist als ein kleiner Neukauf
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
      }
      // Ansonsten einen neuen Server hinstellen
      else if (affordableNewRam >= 8) {
        if (await buyNewServer(ns, affordableNewRam, maxServers, logger)) {
          currentBudget -= ns.cloud.getServerCost(affordableNewRam);
          actionOccurred = true;
        }
      }
    }
    // Fall C: Das Server-Limit ist voll. Wir rüsten den schwächsten Server auf.
    else if (worstServer !== "") {
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
