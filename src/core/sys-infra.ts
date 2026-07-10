import { NS, ProgramName } from "@ns";
import { provisionServer } from "/utils/provision";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js";

// 🎯 ZENTRALE SOFTWARE-MATRIX
const TARGET_PROGRAMS = [
  "BruteSSH.exe",
  "FTPCrack.exe",
  "relaySMTP.exe",
  "HTTPWorm.exe",
  "DarkscapeNavigator.exe", // BB 3.0 Modus
  "SQLInject.exe",
  "Formulas.exe",
] as const;

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const hasSingularity = ns.singularity !== undefined;
  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;

  ns.ui.openTail();

  while (true) {
    let freezePservers = false;

    if (hasSingularity) {
      const homeCostMultiplier = bnMults.HomeComputerRamCost ?? 1.0;
      const baseReserve = homeCostMultiplier > 2 ? 2_000_000 : 500_000;
      const dynamicReserve = Math.max(baseReserve, ns.getPlayer().money * 0.05);

      // 1. Home Upgrades verwalten
      handleHomeServerPurchases(ns, dynamicReserve);
      // 2. Programme kaufen
      handleProgramPurchases(ns);

      // 3. Prüfen, ob wir für das NÄCHSTE Home-Upgrade sparen müssen (Schild-Logik)
      freezePservers = checkHomeUpgradeShield(ns);
    }

    // Übergabe des Flags an die p-Server Verwaltung
    await handleServerPurchases(ns, bnMults, freezePservers);
    printDashboard(ns, freezePservers);

    await ns.sleep(10000);
  }
}

function handleProgramPurchases(ns: NS): void {
  const sing = ns.singularity;
  const player = ns.getPlayer();
  const currentHacking = ns.getHackingLevel();

  if (!ns.hasTorRouter() && player.money >= 200_000 && currentHacking >= 40) {
    if (sing.purchaseTor()) {
      ns.print("[INFRA] 📡 TOR-Router erfolgreich gekauft.");
    }
  }

  if (ns.hasTorRouter()) {
    const programGates: Record<(typeof TARGET_PROGRAMS)[number], number> = {
      "BruteSSH.exe": 50,
      "FTPCrack.exe": 150,
      "relaySMTP.exe": 250,
      "HTTPWorm.exe": 400,
      "DarkscapeNavigator.exe": 0,
      "SQLInject.exe": 800,
      "Formulas.exe": 1000,
    };

    for (const prog of TARGET_PROGRAMS) {
      if (!ns.fileExists(prog, "home")) {
        const requiredLevel = programGates[prog] ?? 0;
        if (currentHacking >= requiredLevel) {
          if (sing.purchaseProgram(prog as ProgramName)) {
            ns.print(`[INFRA] 📡 ${prog} erfolgreich gekauft.`);
          }
        }
        // Log-Spam entfernt. Status wird stattdessen sauber im Dashboard visualisiert.
      }
    }
  }
}

function handleHomeServerPurchases(ns: NS, reserveMoney: number): void {
  const sing = ns.singularity;
  let availableMoney = ns.getPlayer().money - reserveMoney;
  if (availableMoney <= 0) return;

  const ramCost = sing.getUpgradeHomeRamCost();
  if (ramCost !== Infinity && availableMoney >= ramCost) {
    if (sing.upgradeHomeRam()) {
      ns.toast(`Home RAM erweitert!`, "success");
      availableMoney -= ramCost;
    }
  }

  const coreCost = sing.getUpgradeHomeCoresCost();
  if (coreCost !== Infinity && availableMoney >= coreCost) {
    if (sing.upgradeHomeCores()) {
      ns.toast(`Home Cores erweitert!`, "success");
    }
  }
}

function checkHomeUpgradeShield(ns: NS): boolean {
  const nextRamCost = ns.singularity.getUpgradeHomeRamCost();
  const nextCoreCost = ns.singularity.getUpgradeHomeCoresCost();

  if (nextRamCost === Infinity && nextCoreCost === Infinity) return false;

  const currentMoney = ns.getPlayer().money;
  const minHomeCost = Math.min(nextRamCost, nextCoreCost);
  
  const currentServers = ns.cloud.getServerNames();
  const currentMinRam = currentServers.length > 0
    ? Math.min(...currentServers.map((s) => ns.getServerMaxRam(s)))
    : 8;

  const nextPservUpgradeCost =
    ns.cloud.getServerCost(currentMinRam * 2) - ns.cloud.getServerCost(currentMinRam);

  // Schild aktivieren, wenn wir die Hälfte des Geldes haben UND Home nicht 5x teurer ist als ein p-Server-Upgrade
  return currentMoney >= minHomeCost * 0.5 && minHomeCost < nextPservUpgradeCost * 5;
}

async function handleServerPurchases(ns: NS, bnMults: any, freezePservers: boolean): Promise<void> {
  const maxServers = ns.cloud.getServerLimit();
  if (maxServers === 0 || bnMults.PurchasedServerLimit === 0) return;
  if (freezePservers) return; // p-Server weichen dem Home-Sparen

  const maxRam = ns.cloud.getRamLimit();
  let currentBudget = ns.getPlayer().money * 0.9;
  if (currentBudget < 50_000) return;

  // Dynamische RAM-Obergrenze basierend auf vorhandener Software
  let allowedMaxRam = 64;
  if (ns.fileExists("Formulas.exe", "home")) allowedMaxRam = maxRam;
  else if (ns.fileExists("SQLInject.exe", "home")) allowedMaxRam = Math.min(2048, maxRam);
  else if (ns.fileExists("HTTPWorm.exe", "home")) allowedMaxRam = 512;

  let actionOccurred = true;

  while (actionOccurred) {
    actionOccurred = false;
    const currentServers = ns.cloud.getServerNames();
    const homeMaxRam = ns.getServerMaxRam("home");

    // 🚀 BATCHER-RUSH-BEDINGUNG: Home hat 256GB+, aber kein einziger p-serv hat die kritischen 64GB
    const hasEligiblePserv = currentServers.some((s) => ns.getServerMaxRam(s) >= 64);
    const rushSinglePserv = homeMaxRam >= 256 && !hasEligiblePserv && currentServers.length > 0;

    // Wir ermitteln sowohl den schlechtesten als auch den besten Server
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
    while (affordableNewRam * 2 <= allowedMaxRam && ns.cloud.getServerCost(affordableNewRam * 2) <= currentBudget) {
      affordableNewRam *= 2;
    }
    if (ns.cloud.getServerCost(affordableNewRam) > currentBudget) affordableNewRam = 0;

    // FALL 1: Noch überhaupt kein Server vorhanden -> Kaufe den ersten
    if (currentServers.length === 0 && affordableNewRam >= 8) {
      // Direkt mit maximal bezahlbarem RAM (gedeckelt auf 64GB für den Start) initialisieren
      const initialRam = Math.min(affordableNewRam, 64);
      if (await buyNewServer(ns, initialRam, maxServers)) {
        currentBudget -= ns.cloud.getServerCost(initialRam);
        actionOccurred = true;
      }
    } 
    // FALL 2: 🔥 RUSH MODUS AKTIV -> Fokussiere das Upgrade des BESTEN vorhandenen Servers auf 64GB
    else if (rushSinglePserv && bestServer !== "") {
      const nextRam = maxPservRam * 2;
      if (nextRam <= allowedMaxRam) {
        const upgradeCost = ns.cloud.getServerCost(nextRam) - ns.cloud.getServerCost(maxPservRam);
        if (currentBudget >= upgradeCost) {
          if (ns.cloud.upgradeServer(bestServer, nextRam)) {
            currentBudget -= upgradeCost;
            actionOccurred = true;
          }
        }
      }
      // Wichtig: Im Rush-Modus brechen wir hier ab und kaufen KEINE neuen Server,
      // um das Budget komplett für das 64GB-Upgrade zu sichern!
    } 
    // FALL 3: Normalbetrieb & Server-Slots frei -> Gleichmäßiger Ausbau oder Neukauf
    else if (currentServers.length < maxServers) {
      if (worstServer !== "" && minRam < affordableNewRam) {
        const nextRam = minRam * 2;
        const upgradeCost = ns.cloud.getServerCost(nextRam) - ns.cloud.getServerCost(minRam);

        if (currentBudget >= upgradeCost && nextRam <= allowedMaxRam) {
          if (ns.cloud.upgradeServer(worstServer, nextRam)) {
            currentBudget -= upgradeCost;
            actionOccurred = true;
          }
        }
      } else if (affordableNewRam >= 8) {
        if (await buyNewServer(ns, affordableNewRam, maxServers)) {
          currentBudget -= ns.cloud.getServerCost(affordableNewRam);
          actionOccurred = true;
        }
      }
    } 
    // FALL 4: Alle Slots voll -> Upgrade den schwächsten Server (Normalbetrieb)
    else if (worstServer !== "") {
      const nextRam = minRam * 2;
      if (nextRam <= allowedMaxRam) {
        const upgradeCost = ns.cloud.getServerCost(nextRam) - ns.cloud.getServerCost(minRam);
        if (currentBudget >= upgradeCost) {
          if (ns.cloud.upgradeServer(worstServer, nextRam)) {
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
    await provisionServer(ns, name);
    return true;
  }
  return false;
}

function printDashboard(ns: NS, isHomePrioritized: boolean): void {
  ns.clearLog();

  const homeMaxRam = ns.getServerMaxRam("home");
  const homeUsedRam = ns.getServerUsedRam("home");
  const homeCores = ns.getServer("home").cpuCores;

  ns.print(`============================================================`);
  ns.print(` ⚙️  BIT-OS INFRASTRUCTURE MONITOR`);
  ns.print(`============================================================`);
  ns.print(`🏠 HOME COMPUTER`);
  ns.print(`   RAM:   ${ns.format.ram(homeMaxRam).padEnd(9)} (Genutzt: ${ns.format.ram(homeUsedRam)})`);
  ns.print(`   CORES: ${homeCores} Kerne`);

if (ns.singularity) {
    const pServers = ns.cloud.getServerNames();
    const has64gbPserv = pServers.some((s) => ns.getServerMaxRam(s) >= 64);
    const isRushMode = homeMaxRam >= 256 && !has64gbPserv && pServers.length > 0;

    if (isHomePrioritized) {
      ns.print(`   🚦 STRATEGIE: 👑 HOME-PRIORITÄT AKTIV (P-Serv eingefroren)`);
    } else if (isRushMode) {
      ns.print(`   🚦 STRATEGIE: 🚀 BATCHER-RUSH (Fokus auf ein einzelnes 64GB P-Serv)`);
    } else {
      ns.print(`   🚦 STRATEGIE: 💸 Normalbetrieb (Netzwerk-Expansion)`);
    }
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
      const bar = "█".repeat(Math.round((used / ram) * 10)) + "░".repeat(10 - Math.round((used / ram) * 10));
      ns.print(`   • ${server.padEnd(12)} : ${ns.format.ram(ram).padStart(9)}  [${bar}]`);
    });
  }
  ns.print(`   Kapazität: ${currentServers.length} / ${maxServers} Server slots genutzt.`);
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