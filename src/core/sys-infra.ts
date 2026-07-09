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
    if (hasSingularity) {
      const homeCostMultiplier = bnMults.HomeComputerRamCost ?? 1.0;
      const baseReserve = homeCostMultiplier > 2 ? 2_000_000 : 500_000;
      const dynamicReserve = Math.max(baseReserve, ns.getPlayer().money * 0.05);

      handleHomeServerPurchases(ns, dynamicReserve);
      // 🔥 REPARATUR: bnMults wird jetzt mitgegeben
      handleProgramPurchases(ns, bnMults);
    }

    await handleServerPurchases(ns, bnMults);
    printDashboard(ns);

    await ns.sleep(10000);
  }
}

function handleProgramPurchases(ns: NS, bnMults: any): void {
  const sing = ns.singularity;
  const player = ns.getPlayer();
  const currentHacking = ns.getHackingLevel();

  // 🛡️ EARLY-GAME PROTECTOR FOR TOR: 
  // Kauf den TOR-Router erst, wenn wir uns dem ersten sinnvollen Meilenstein (Level 40+) nähern.
  if (!ns.hasTorRouter() && player.money >= 200_000 && currentHacking >= 40) {
    if (sing.purchaseTor()) {
      ns.print("[INFRA] 📡 TOR-Router erfolgreich gekauft.");
    }
  }

  if (ns.hasTorRouter()) {
    // 🧠 MATHEMATISCHE LEVEL-GATES
    // Definiert das exakte Mindest-Hackinglevel, ab dem ein Kauf überhaupt Sinn ergibt
    const programGates: Record<typeof TARGET_PROGRAMS[number], number> = {
      "BruteSSH.exe": 50,         // Erster 1-Port-Server: neo-net (Lvl 50)
      "FTPCrack.exe": 150,        // Erster 2-Port-Server: silver-helix (Lvl 150)
      "relaySMTP.exe": 250,       // Erster 3-Port-Server: omega-net (Lvl 200-250)
      "HTTPWorm.exe": 400,        // Erster 4-Port-Server: univ-energy (Lvl 390)
      "DarkscapeNavigator.exe": 0,// Utility (keine Sperre nötig)
      "SQLInject.exe": 800,       // Erster 5-Port-Server: Megacorps / ecorp (Lvl 900)
      "Formulas.exe": 1000,       // Macht erst Sinn, wenn wir genug RAM für hochentwickelte Batcher haben
    };

    for (const prog of TARGET_PROGRAMS) {
      if (!ns.fileExists(prog, "home")) {
        const requiredLevel = programGates[prog] ?? 0;

        // 🔥 STRATEGISCHER FILTER: Nur kaufen, wenn das Hacking-Level reif dafür ist!
        if (currentHacking >= requiredLevel) {
          if (sing.purchaseProgram(prog as ProgramName)) {
            ns.print(`[INFRA] 📡 ${prog} erfolgreich gekauft.`);
          }
        } else {
          // Optionaler Log-Eintrag zur Veranschaulichung im Early Game
          ns.print(`⏳ [Sperre] ${prog} blockiert bis Hacking-Level ${requiredLevel} (Aktuell: ${currentHacking}).`);
        }
      }
    }
  }
}

// ======================================================================
// [Restliche Funktionen handleHomeServerPurchases, handleServerPurchases, buyNewServer und printDashboard bleiben unverändert]
// ======================================================================
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

async function handleServerPurchases(ns: NS, bnMults: any): Promise<void> {
  const maxServers = ns.cloud.getServerLimit();
  if (maxServers === 0 || bnMults.PurchasedServerLimit === 0) return;

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
      if (await buyNewServer(ns, affordableNewRam, maxServers)) {
        currentBudget -= ns.cloud.getServerCost(affordableNewRam);
        actionOccurred = true;
      }
    } else if (currentServers.length < maxServers) {
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
    } else if (worstServer !== "") {
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

function printDashboard(ns: NS): void {
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
  ns.print("------------------------------------------------------------");

  ns.print(`🖥️  CLOUD-NETZWERK (PURCHASED SERVERS)`);
  const currentServers = ns.cloud.getServerNames();
  const maxServers = ns.cloud.getServerLimit();

  if (currentServers.length === 0) {
    ns.print(`   [Keine kaufbaren Server im aktuellen BitNode registriert]`);
  } else {
    currentServers.sort().forEach(server => {
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
    const hasFile = ns.fileExists(progName, "home");
    const status = hasFile ? "✅" : "❌";
    
    gridLine += `[${status}] ${progName.padEnd(22)}`;
    
    if ((i + 1) % 2 === 0 || i === TARGET_PROGRAMS.length - 1) {
      ns.print(gridLine);
      gridLine = "   ";
    }
  }
  ns.print(`============================================================`);
}