import { NS, ProgramName } from "@ns";

export async function main(ns: NS): Promise<void> {
  // ns.disableLog("ALL");

  while (true) {
    // Erhöhte Reserve auf 500k nach einem Reset, damit TOR und BruteSSH sofort gekauft werden können
    handleHomeServerPurchases(ns, 500_000);
    handleProgramPurchases(ns);
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
      ns.print(`[HOME] RAM erweitert! Cost: ${ns.format.number(ramCost)}`);
      availableMoney -= ramCost;
    }
  }

  const coreCost = sing.getUpgradeHomeCoresCost();
  if (availableMoney >= coreCost) {
    if (sing.upgradeHomeCores()) {
      ns.print(`[HOME] Cores erweitert! Cost: ${ns.format.number(coreCost)}`);
    }
  }
}

function handleProgramPurchases(ns: NS): void {
  const sing = ns.singularity;
  const money = ns.getPlayer().money;

  if (!ns.hasTorRouter() && money >= 200_000) {
    sing.purchaseTor();
  }

  if (ns.hasTorRouter()) {
    const programs: ProgramName[] = [
      "BruteSSH.exe" as ProgramName,
      "FTPCrack.exe" as ProgramName,
      "relaySMTP.exe" as ProgramName,
      "DarkscapeNavigator.exe" as ProgramName,
      "HTTPWorm.exe" as ProgramName,
      "SQLInject.exe" as ProgramName,
      "Formulas.exe" as ProgramName,
    ];
    for (const prog of programs) {
      if (!ns.fileExists(prog, "home")) {
        sing.purchaseProgram(prog);
      }
    }
  }
}

function handleServerPurchases(ns: NS): void {
  const maxServers = ns.cloud.getServerLimit();
  const currentServers = ns.cloud.getServerNames();
  const maxRam = ns.cloud.getRamLimit();
  const money = ns.getPlayer().money;

  if (money < 50_000) return;

  // --- NEU: POSITIVES STUFENMODELL (State Machine) ---
  const hasHTTPWorm = ns.fileExists("HTTPWorm.exe", "home");
  const hasSQLInject = ns.fileExists("SQLInject.exe", "home");
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  let allowedMaxRam = 64; // Standard-Basis-Cap für das Early Game

  if (hasHTTPWorm && hasSQLInject && hasFormulas) {
    // STUFE 4: Absolutes Late-Game. Alle drei Programme sind da -> Unbegrenzter Ausbau
    allowedMaxRam = maxRam;
  } else if (hasHTTPWorm && hasSQLInject) {
    // STUFE 3 (Normaler BitNode): 5 Ports offen, wir sparen die 5 Milliarden für Formulas.exe
    allowedMaxRam = 64;
  } else if (hasHTTPWorm) {
    // STUFE 2: 4 Ports offen (HTTPWorm da, aber SQLInject fehlt noch)
    allowedMaxRam = 32;
  } else {
    // STUFE 1: Early Game (Kein HTTPWorm vorhanden)
    allowedMaxRam = 16;
  }

  // 1. KAUF NEUER SERVER
  if (currentServers.length < maxServers) {
    let targetRam = 8;
    while (
      targetRam * 2 <= allowedMaxRam &&
      ns.cloud.getServerCost(targetRam * 2) <= money
    ) {
      targetRam *= 2;
    }
    
    const cost = ns.cloud.getServerCost(targetRam);
    if (money >= cost && targetRam >= 8) {
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

      if (name === "") {
        name = `p-serv-${Date.now()}`;
      }

      ns.cloud.purchaseServer(name, targetRam);
    }
  } 
  // 2. UPGRADE EXISTIERENDER SERVER
  else {
    let minRam = maxRam;
    let worstServer = "";

    for (const server of currentServers) {
      const ram = ns.getServerMaxRam(server);
      if (ram < minRam) {
        minRam = ram;
        worstServer = server;
      }
    }

    if (worstServer !== "") {
      const nextRam = minRam * 2;
      
      // Wenn das nächste Upgrade das erlaubte Stufen-Limit überschreitet, blockieren
      if (nextRam > allowedMaxRam) {
        return; 
      }

      const upgradeCost =
        ns.cloud.getServerCost(nextRam) - ns.cloud.getServerCost(minRam);

      if (money >= upgradeCost) {
        ns.cloud.upgradeServer(worstServer, nextRam);
      }
    }
  }
}