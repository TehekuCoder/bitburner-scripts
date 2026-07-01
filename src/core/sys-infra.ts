import { NS, ProgramName } from "@ns";

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

function handleServerPurchases(ns: NS): void {
  const maxServers = ns.cloud.getServerLimit();
  const maxRam = ns.cloud.getRamLimit();

  // Wir bleiben strikt innerhalb des 90%-Budgets, um das Firmenkonto/andere Skripte zu schützen
  let currentBudget = ns.getPlayer().money * 0.9;
  if (currentBudget < 50_000) return;

  // --- DYNAMISCHES STUFENMODELL ---
  const hasHTTPWorm = ns.fileExists("HTTPWorm.exe", "home");
  const hasSQLInject = ns.fileExists("SQLInject.exe", "home");
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  let allowedMaxRam = 64;
  if (hasFormulas) allowedMaxRam = maxRam;
  else if (hasSQLInject) allowedMaxRam = Math.min(2048, maxRam);
  else if (hasHTTPWorm) allowedMaxRam = 512;
  else allowedMaxRam = 64;

  let actionOccurred = true;

  // UNIFIZIERTER KAUFRAUSCH-LOOP
  while (actionOccurred) {
    actionOccurred = false;
    const currentServers = ns.cloud.getServerNames();

    // 1. Den aktuell schwächsten Server ermitteln
    let minRam = maxRam;
    let worstServer = "";
    for (const server of currentServers) {
      const ram = ns.getServerMaxRam(server);
      if (ram < minRam) {
        minRam = ram;
        worstServer = server;
      }
    }

    // 2. Maximal leistbares RAM für einen potenziellen NEUEN Server berechnen
    let affordableNewRam = 8;
    while (
      affordableNewRam * 2 <= allowedMaxRam &&
      ns.cloud.getServerCost(affordableNewRam * 2) <= currentBudget
    ) {
      affordableNewRam *= 2;
    }
    if (ns.cloud.getServerCost(affordableNewRam) > currentBudget) {
      affordableNewRam = 0; // Zu pleite für einen neuen 8GB Server
    }

    // 3. ENTSCHEIDUNGSMATRIX (Kauf vs. Upgrade)
    
    // FALL A: Keine Server vorhanden? -> Basis-Infrastruktur schaffen
    if (currentServers.length === 0 && affordableNewRam >= 8) {
      if (buyNewServer(ns, affordableNewRam, maxServers)) {
        currentBudget -= ns.cloud.getServerCost(affordableNewRam);
        actionOccurred = true;
      }
    }
    // FALL B: Wir haben Server, sind aber unter dem Limit von 25
    else if (currentServers.length < maxServers) {
      // QUALITÄTSKONTROLLE: Ist unser schwächster Server schlechter als das, was wir uns 
      // bar leisten könnten? Dann ziehen wir den alten Krüppel-Server ERST hoch (Konsolidierung)!
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
      // Der schwächste Server hält bereits mit unserem Kontostand Schritt? Dann expandieren wir!
      else if (affordableNewRam >= 8) {
        if (buyNewServer(ns, affordableNewRam, maxServers)) {
          currentBudget -= ns.cloud.getServerCost(affordableNewRam);
          actionOccurred = true;
        }
      }
    }
    // FALL C: Server-Limit (25/25) erreicht -> Reiner Upgrade-Modus für das Endgame
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

// Hilfsfunktion zur sauberen Namensermittlung und Kaufausführung
function buyNewServer(ns: NS, ram: number, maxServers: number): boolean {
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
    return true;
  }
  return false;
}