import { NS, ProgramName } from "@ns";
import { TARGET_PROGRAMS } from "/lib/constants";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { patchFinanceState } from "/lib/state.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Infra-Sing");
  const currentHacking = ns.getHackingLevel();

  // 🎯 1. Home Server Upgrade ZUERST ausführen (Priorität vor Software!)
  handleHomeServerPurchases(ns, logger);

  // 🎯 2. Erst DANACH verfügbares Geld für Programme nutzen
  handleProgramPurchases(ns, logger, currentHacking);

  // 3. Kombinierten Shield berechnen und Status speichern
  const shieldActive = checkUnifiedUpgradeShield(ns, currentHacking);

  patchFinanceState(ns, {
    isHomePrioritized: shieldActive,
    homeCores: ns.getServer("home").cpuCores,
  });
}

function handleHomeServerPurchases(ns: NS, logger: Logger): void {
  const sing = ns.singularity;
  const homeMaxRam = ns.getServerMaxRam("home");

  const safetyBuffer = 200_000;
  let availableMoney = ns.getPlayer().money - safetyBuffer;
  if (availableMoney <= 0) return;

  const ramCost = sing.getUpgradeHomeRamCost();
  const coreCost = sing.getUpgradeHomeCoresCost();

  // RAM-Upgrade durchführen
  if (ramCost !== Infinity && availableMoney >= ramCost) {
    if (sing.upgradeHomeRam()) {
      const newRam = ns.getServerMaxRam("home");
      ns.toast(`Home RAM erweitert auf ${ns.format.ram(newRam)}!`, "success");
      logger.success(`🏠 Home-RAM Upgrade durchgeführt: ${ns.format.ram(newRam)}`);
      availableMoney -= ramCost;
    }
  }

  // Cores erst ab 1 TB RAM nachziehen
  if (homeMaxRam >= 1024 && coreCost !== Infinity && availableMoney >= coreCost) {
    if (sing.upgradeHomeCores()) {
      ns.toast(`Home Cores erweitert!`, "success");
      logger.success("🏠 Home-Cores Upgrade durchgeführt.");
    }
  }
}

function handleProgramPurchases(
  ns: NS,
  logger: Logger,
  currentHacking: number,
): void {
  const sing = ns.singularity;

  if (!ns.hasTorRouter() && ns.getPlayer().money >= 200_000 && currentHacking >= 40) {
    if (sing.purchaseTor()) logger.success("📡 TOR-Router erfolgreich erworben.");
  }

  if (ns.hasTorRouter()) {
    const programGates: Record<string, number> = {
      "BruteSSH.exe": 50,
      "FTPCrack.exe": 150,
      "relaySMTP.exe": 250,
      "HTTPWorm.exe": 350,
      "SQLInject.exe": 500,
      "Formulas.exe": 0,
    };

    for (const prog of TARGET_PROGRAMS) {
      if (!ns.fileExists(prog, "home")) {
        const requiredLevel = programGates[prog] ?? 0;
        if (currentHacking >= requiredLevel) {
          if (sing.purchaseProgram(prog as ProgramName)) {
            logger.success(`💾 Software erfolgreich lizenziert: ${prog}`);
          }
        }
      }
    }
  }
}

function checkUnifiedUpgradeShield(ns: NS, currentHacking: number): boolean {
  const sing = ns.singularity;
  const nextRamCost = sing.getUpgradeHomeRamCost();
  const nextCoreCost = sing.getUpgradeHomeCoresCost();
  const homeMaxRam = ns.getServerMaxRam("home");

  let programReserve = 0;
  let targetProgramName = "Keines";

  // 🎯 Shield reserviert nur Geld für Programme, wenn das Hacking-Level AUCH ausreicht!
  if (!ns.serverExists("darkweb") && currentHacking >= 40) {
    programReserve = 200_000;
    targetProgramName = "TOR Router";
  } else if (!ns.fileExists("BruteSSH.exe", "home") && currentHacking >= 50) {
    programReserve = 500_000;
    targetProgramName = "BruteSSH";
  } else if (!ns.fileExists("FTPCrack.exe", "home") && currentHacking >= 150) {
    programReserve = 1_500_000;
    targetProgramName = "FTPCrack";
  } else if (!ns.fileExists("relaySMTP.exe", "home") && currentHacking >= 250) {
    programReserve = 5_000_000;
    targetProgramName = "relaySMTP";
  } else if (!ns.fileExists("HTTPWorm.exe", "home") && currentHacking >= 350) {
    programReserve = 30_000_000;
    targetProgramName = "HTTPWorm";
  } else if (!ns.fileExists("SQLInject.exe", "home") && currentHacking >= 500) {
    programReserve = 250_000_000;
    targetProgramName = "SQLInject";
  } else if (!ns.fileExists("Formulas.exe", "home") && homeMaxRam >= 1024) {
    programReserve = 5_000_000_000;
    targetProgramName = "Formulas.exe";
  }

  const currentMoney = ns.getPlayer().money;
  let financeProgress = "Infrastruktur stabil";

  if (programReserve > 0) {
    financeProgress = `Sichere $${ns.format.number(programReserve, 0)} (${targetProgramName})`;
  }

  const targetUpgradeCost =
    homeMaxRam < 256 && nextRamCost !== Infinity
      ? nextRamCost
      : Math.min(nextRamCost, nextCoreCost);

  const shieldActive = homeMaxRam < 128 || currentMoney >= targetUpgradeCost * 0.2;

  const finalReserve = Math.max(
    programReserve,
    shieldActive ? targetUpgradeCost : 0,
  );

  patchFinanceState(ns, {
    moneyReserve: finalReserve,
    financeProgress:
      programReserve > (shieldActive ? targetUpgradeCost : 0)
        ? financeProgress
        : `Spare auf Home-Upgrade ($${ns.format.number(targetUpgradeCost)})`,
    isRushModeActive: false,
  });

  return shieldActive;
}