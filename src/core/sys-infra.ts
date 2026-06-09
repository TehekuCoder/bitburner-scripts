import { NS, ProgramName } from "@ns";

export async function main(ns: NS): Promise<void> {
  // ns.disableLog("ALL");

  while (true) {
    // Hält 200k flüssig für Eventualitäten
    handleHomeServerPurchases(ns, 200_000);
    handleProgramPurchases(ns);
    handleServerPurchases(ns);

    // Reicht völlig aus, alle 10 Sekunden nach Upgrades zu schauen
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

  if (currentServers.length < maxServers) {
    let targetRam = 8;
    while (
      targetRam * 2 <= maxRam &&
      ns.cloud.getServerCost(targetRam * 2) <= money
    ) {
      targetRam *= 2;
    }
    const cost = ns.cloud.getServerCost(targetRam);
    if (money >= cost) {
      // Findet die erste freie Nummer zwischen 01 und maxServers
      let nextFreeNumber = 1;
      let name = "";

      while (nextFreeNumber <= maxServers) {
        const suffix = String(nextFreeNumber).padStart(2, "0");
        const potentialName = `p-serv-${suffix}`;

        // Wenn der Name noch nicht existiert, haben wir unsere Nummer
        if (!currentServers.includes(potentialName)) {
          name = potentialName;
          break;
        }
        nextFreeNumber++;
      }

      // Sicherheits-Fallback, falls unerwartet kein Name generiert werden konnte
      if (name === "") {
        name = `p-serv-${Date.now()}`;
      }

      ns.cloud.purchaseServer(name, targetRam);
    }
  } else {
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
      const upgradeCost =
        ns.cloud.getServerCost(nextRam) - ns.cloud.getServerCost(minRam);

      if (money >= upgradeCost) {
        ns.cloud.upgradeServer(worstServer, nextRam);
      }
    }
  }
}
