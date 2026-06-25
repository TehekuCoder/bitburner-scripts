import { NS, ProgramName } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  // Singularity-Verfügbarkeit einmalig prüfen
  const hasSingularity = ns.singularity !== undefined;

  while (true) {
    // Failsafe Layer: Singularity-Funktionen nur ausführen, wenn die API existiert
    if (hasSingularity) {
      // Dynamische Reserve: 500k im Early-Game, im Late-Game behalten wir 5% des Kapitals flüssig
      const dynamicReserve = Math.max(500_000, ns.getPlayer().money * 0.05);
      handleHomeServerPurchases(ns, dynamicReserve);
      handleProgramPurchases(ns);
    } else {
      ns.print(
        "ℹ️ [INFRA] Singularity-Upgrades inaktiv (SF4 nicht verfügbar).",
      );
    }

    // Cloud-Server-Käufe laufen immer, da sie keine Singularity-Rechte benötigen
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
      ns.print(
        `[HOME] ✅ Cores erweitert! Cost: $${ns.format.number(coreCost)}`,
      );
    }
  }
}

function handleProgramPurchases(ns: NS): void {
  const sing = ns.singularity;
  const money = ns.getPlayer().money;

  // TOR-Router Kauf (Zusätzlich abgesichert über den Rückgabewert)
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
        // 🔥 Wichtig: Nur loggen, wenn purchaseProgram wirklich 'true' zurückgibt!
        if (sing.purchaseProgram(prog)) {
          ns.print(`[INFRA] 📡 ${prog} erfolgreich gekauft.`);
        }
      }
    }
  }
}

function handleServerPurchases(ns: NS): void {
  const maxServers = ns.cloud.getServerLimit();
  const currentServers = ns.cloud.getServerNames();
  const maxRam = ns.cloud.getRamLimit();

  // Wir nutzen 90% des Geldes für Cloud-Server, um immer einen kleinen Puffer zu haben
  const serverBudget = ns.getPlayer().money * 0.9;
  if (serverBudget < 50_000) return;

  // --- OPTIMIERTES POSITIVES STUFENMODELL ---
  // Die RAM-Stufen wurden massiv angehoben, um die 5 Milliarden für Formulas schneller zu erfarmen.
  const hasHTTPWorm = ns.fileExists("HTTPWorm.exe", "home");
  const hasSQLInject = ns.fileExists("SQLInject.exe", "home");
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  let allowedMaxRam = 64;

  if (hasFormulas) {
    allowedMaxRam = maxRam; // STUFE 4: Endgame (Unbegrenzt)
  } else if (hasSQLInject) {
    allowedMaxRam = Math.min(2048, maxRam); // STUFE 3: Perfekter RAM-Schub, um die 5B für Formulas zu generieren!
  } else if (hasHTTPWorm) {
    allowedMaxRam = 512; // STUFE 2: Mid-Game
  } else {
    allowedMaxRam = 64; // STUFE 1: Frühes Early-Game
  }

  // 1. KAUF NEUER SERVER (Bis zum Limit von 25 Stück)
  if (currentServers.length < maxServers) {
    let targetRam = 8;
    // Ermittle das größte bezahlbare RAM-Paket innerhalb des Stufenlimits
    while (
      targetRam * 2 <= allowedMaxRam &&
      ns.cloud.getServerCost(targetRam * 2) <= serverBudget
    ) {
      targetRam *= 2;
    }

    const cost = ns.cloud.getServerCost(targetRam);
    if (serverBudget >= cost && targetRam >= 8) {
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

      if (ns.cloud.purchaseServer(name, targetRam)) {
        ns.print(
          `[CLOUD] 🖥️ Neuen Server gekauft: ${name} (${ns.format.ram(targetRam)})`,
        );
      }
    }
  }
  // 2. BATCH-UPGRADE EXISTIERENDER SERVER (Kaufrausch-Modus)
  else {
    let upgradeOccurred = true;

    // Die Schleife läuft so lange, wie wir Geld haben und Upgrades möglich sind
    while (upgradeOccurred) {
      upgradeOccurred = false;
      let minRam = maxRam;
      let worstServer = "";

      // Finde den aktuell schwächsten Server
      for (const server of currentServers) {
        const ram = ns.getServerMaxRam(server);
        if (ram < minRam) {
          minRam = ram;
          worstServer = server;
        }
      }

      if (worstServer !== "") {
        const nextRam = minRam * 2;

        // Abbrechen, wenn der schwächste Server bereits das Stufen-Limit erreicht hat
        if (nextRam > allowedMaxRam) break;

        const upgradeCost =
          ns.cloud.getServerCost(nextRam) - ns.cloud.getServerCost(minRam);

        if (ns.getPlayer().money >= upgradeCost) {
          if (ns.cloud.upgradeServer(worstServer, nextRam)) {
            ns.print(
              `[CLOUD] 📈 Upgrade: ${worstServer} auf ${ns.format.ram(nextRam)} ($${ns.format.number(upgradeCost)})`,
            );
            // Schleife bleibt aktiv: Wenn noch Geld da ist, wird sofort der nächste Server hochgezogen!
            upgradeOccurred = true;
          }
        }
      }
    }
  }
}
