import { NS, ProgramName } from "@ns";
import { provisionServer } from "/utils/provision";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const hasSingularity = ns.singularity !== undefined;

  while (true) {
    if (hasSingularity) {
      const dynamicReserve = Math.max(500_000, ns.getPlayer().money * 0.05);
      handleHomeServerPurchases(ns, dynamicReserve);
      handleProgramPurchases(ns);
    } else {
      ns.print("ℹ️ [INFRA] Singularity-Upgrades inaktiv (SF4 nicht verfügbar).");
    }

    // Cloud-Server-Käufe laufen mit optimierter Logik
    handleServerPurchases(ns);

    await ns.sleep(10000);
  }
}

function handleHomeServerPurchases(ns: NS, reserveMoney: number): void {
  const sing = ns.singularity;
  let availableMoney = ns.getPlayer().money - reserveMoney;
  if (availableMoney <= 0) return;

  const ramCost = sing.getUpgradeHomeRamCost();
  if (availableMoney >= ramCost) {
    if (sing.upgradeHomeRam()) {
      ns.print(`[HOME] ✅ RAM erweitert! Cost: $${ns.format.number(ramCost)}`);
      availableMoney -= ramCost;
    }
  }

  const coreCost = sing.getUpgradeHomeCoresCost();
  if (availableMoney >= coreCost) {
    if (sing.upgradeHomeCores()) {
      ns.print(`[HOME] ✅ Cores erweitert! Cost: $${ns.format.number(coreCost)}`);
    }
  }
}

function handleProgramPurchases(ns: NS): void {
  const sing = ns.singularity;
  const money = ns.getPlayer().money;

  if (!ns.hasTorRouter() && money >= 200_000) {
    if (sing.purchaseTor()) {
      ns.print("[INFRA] 📡 TOR-Router erfolgreich gekauft.");
    }
  }

  if (ns.hasTorRouter()) {
    const programs: ProgramName[] = [
      "BruteSSH.exe" as ProgramName,
      "FTPCrack.exe" as ProgramName,
      "relaySMTP.exe" as ProgramName,
      "HTTPWorm.exe" as ProgramName,
      "DarkscapeNavigator.exe" as ProgramName,
      "SQLInject.exe" as ProgramName,
      "Formulas.exe" as ProgramName,
    ];

    for (const prog of programs) {
      if (!ns.fileExists(prog, "home")) {
        if (sing.purchaseProgram(prog)) {
          ns.print(`[INFRA] 📡 ${prog} erfolgreich gekauft.`);
        }
      }
    }
  }
}

async function handleServerPurchases(ns: NS): Promise<void> {
  const maxServers = ns.cloud.getServerLimit();
  const maxRam = ns.cloud.getRamLimit();

  let currentBudget = ns.getPlayer().money * 0.9;
  if (currentBudget < 50_000) return;

  const hasHTTPWorm = ns.fileExists("HTTPWorm.exe", "home");
  const hasSQLInject = ns.fileExists("SQLInject.exe", "home");
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  let allowedMaxRam = 64;
  if (hasFormulas) allowedMaxRam = maxRam;
  else if (hasSQLInject) allowedMaxRam = Math.min(2048, maxRam);
  else if (hasHTTPWorm) allowedMaxRam = 512;
  else allowedMaxRam = 64;

  let actionOccurred = true;

  while (actionOccurred) {
    actionOccurred = false;
    const currentServers = ns.cloud.getServerNames();

    let minRam = maxRam;
    let worstServer = "";
    for (const server of currentServers) {
      const ram = ns.getServerMaxRam(server);
      if (ram < minRam) {
        minRam = ram;
        worstServer = server;
      }
    }

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

    if (currentServers.length === 0 && affordableNewRam >= 8) {
      if (await buyNewServer(ns, affordableNewRam, maxServers)) { // ⚠️ AWAIT
        currentBudget -= ns.cloud.getServerCost(affordableNewRam);
        actionOccurred = true;
      }
    }
    else if (currentServers.length < maxServers) {
      if (worstServer !== "" && minRam < affordableNewRam) {
        const nextRam = minRam * 2;
        const upgradeCost = ns.cloud.getServerCost(nextRam) - ns.cloud.getServerCost(minRam);
        
        if (currentBudget >= upgradeCost && nextRam <= allowedMaxRam) {
          if (ns.cloud.upgradeServer(worstServer, nextRam)) {
            ns.print(`[CLOUD] 📈 Konsolidierung: ${worstServer} auf ${ns.format.ram(nextRam)} ($${ns.format.number(upgradeCost)})`);
            currentBudget -= upgradeCost;
            actionOccurred = true;
          }
        }
      } 
      else if (affordableNewRam >= 8) {
        if (await buyNewServer(ns, affordableNewRam, maxServers)) { // ⚠️ AWAIT
          currentBudget -= ns.cloud.getServerCost(affordableNewRam);
          actionOccurred = true;
        }
      }
    }
    else if (worstServer !== "") {
      const nextRam = minRam * 2;
      if (nextRam <= allowedMaxRam) {
        const upgradeCost = ns.cloud.getServerCost(nextRam) - ns.cloud.getServerCost(minRam);
        if (currentBudget >= upgradeCost) {
          if (ns.cloud.upgradeServer(worstServer, nextRam)) {
            ns.print(`[CLOUD] 📈 Upgrade: ${worstServer} auf ${ns.format.ram(nextRam)} ($${ns.format.number(upgradeCost)})`);
            currentBudget -= upgradeCost;
            actionOccurred = true;
          }
        }
      }
    }
  }
}
async function buyNewServer(ns: NS, ram: number, maxServers: number): Promise<boolean> {
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
    ns.print(`[CLOUD] 🖥️ Neuen Server gekauft: ${name} (${ns.format.ram(ram)})`);
    
    // 🔥 DIREKT NACH DEM KAUF: Worker-Skripte rüberschieben
    await provisionServer(ns, name);
    
    return true;
  }
  return false;
}