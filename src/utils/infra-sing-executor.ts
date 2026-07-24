import { NS, ProgramName } from "@ns";
import { DEFAULT_MULTIPLIERS, TARGET_PROGRAMS } from "/lib/constants";
import { Logger } from "/lib/logger";
import { loadBnMults, patchState } from "/lib/state";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Infra-Sing", "INFO");
  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;

  const currentHacking = ns.getHackingLevel();

  // 1. Programme kaufen
  handleProgramPurchases(ns, logger, currentHacking);

  // 2. Home Server Upgrades durchführen
  handleHomeServerPurchases(ns, logger);

  // 3. Kombinierten Home- & Programm-Shield berechnen und wegschreiben
  const shieldActive = checkUnifiedUpgradeShield(ns);

  // 4. Aktuelle CPU-Kerne erfassen
  const homeCores = ns.getServer("home").cpuCores;

  patchState(ns, {
    isHomePrioritized: shieldActive,
    homeCores: homeCores,
  });
}

function handleProgramPurchases(
  ns: NS,
  logger: Logger,
  currentHacking: number,
): void {
  const sing = ns.singularity;
  if (
    !ns.hasTorRouter() &&
    ns.getPlayer().money >= 200_000 &&
    currentHacking >= 40
  ) {
    if (sing.purchaseTor())
      logger.success("📡 TOR-Router erfolgreich erworben.");
  }

  if (ns.hasTorRouter()) {
    const programGates: Record<string, number> = {
      "BruteSSH.exe": 50,
      "FTPCrack.exe": 150,
      "relaySMTP.exe": 250,
      "HTTPWorm.exe": 350,
      "DarkscapeNavigator.exe": 0,
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

function handleHomeServerPurchases(ns: NS, logger: Logger): void {
  const sing = ns.singularity;
  const homeMaxRam = ns.getServerMaxRam("home");

  const safetyBuffer = 200_000;
  let availableMoney = ns.getPlayer().money - safetyBuffer;
  if (availableMoney <= 0) return;

  const ramCost = sing.getUpgradeHomeRamCost();
  const coreCost = sing.getUpgradeHomeCoresCost();

  if (homeMaxRam < 256) {
    if (ramCost !== Infinity && availableMoney >= ramCost) {
      if (sing.upgradeHomeRam()) {
        const newRam = ns.getServerMaxRam("home");
        ns.toast(`Home RAM erweitert!`, "success");
        logger.success(
          `🏠 Home-RAM Upgrade durchgeführt. Neuer Wert: ${ns.format.ram(newRam)}`,
        );
        availableMoney -= ramCost;
      }
    }
    if (coreCost !== Infinity && availableMoney >= coreCost) {
      if (ramCost === Infinity || availableMoney - coreCost >= ramCost) {
        if (sing.upgradeHomeCores()) {
          ns.toast(`Home Cores erweitert!`, "success");
          logger.success("🏠 Home-Cores Upgrade durchgeführt.");
        }
      }
    }
  } else {
    if (ramCost !== Infinity && availableMoney >= ramCost) {
      if (sing.upgradeHomeRam()) {
        const newRam = ns.getServerMaxRam("home");
        ns.toast(`Home RAM erweitert!`, "success");
        logger.success(
          `🏠 Home-RAM Upgrade durchgeführt. Neuer Wert: ${ns.format.ram(newRam)}`,
        );
        availableMoney -= ramCost;
      }
    }
    // 🎯 SPRINT-FIX: Cores werden erst gekauft, wenn das 1 TB RAM Ziel steht!
    if (
      homeMaxRam >= 1024 &&
      coreCost !== Infinity &&
      availableMoney >= coreCost
    ) {
      if (sing.upgradeHomeCores()) {
        ns.toast(`Home Cores erweitert!`, "success");
        logger.success("🏠 Home-Cores Upgrade durchgeführt.");
      }
    }
  }
}

function checkUnifiedUpgradeShield(ns: NS): boolean {
  const sing = ns.singularity;
  const nextRamCost = sing.getUpgradeHomeRamCost();
  const nextCoreCost = sing.getUpgradeHomeCoresCost();
  const homeMaxRam = ns.getServerMaxRam("home");

  // --- 📦 HIER IST DIE ZENTRALISIERTE PROGRAMM-RESERVE ---
  let programReserve = 0;
  let targetProgramName = "Keines";

  if (!ns.serverExists("darkweb")) {
    programReserve = 200_000;
    targetProgramName = "TOR Router";
  } else if (!ns.fileExists("BruteSSH.exe", "home")) {
    programReserve = 500_000;
    targetProgramName = "BruteSSH";
  } else if (!ns.fileExists("FTPCrack.exe", "home")) {
    programReserve = 1_500_000;
    targetProgramName = "FTPCrack";
  } else if (!ns.fileExists("relaySMTP.exe", "home")) {
    programReserve = 5_000_000;
    targetProgramName = "relaySMTP";
  } else if (!ns.fileExists("HTTPWorm.exe", "home")) {
    programReserve = 30_000_000;
    targetProgramName = "HTTPWorm";
  } else if (!ns.fileExists("SQLInject.exe", "home")) {
    programReserve = 250_000_000;
    targetProgramName = "SQLInject";
  } else if (!ns.fileExists("Formulas.exe", "home")) {
    // 🎯 SPRINT-FIX: Wenn Home unter 1 TB ist, ignorieren wir die 5-Milliarden-Sperre für Formulas
    if (homeMaxRam < 1024) {
      programReserve = 0;
    } else {
      programReserve = 5_000_000_000;
      targetProgramName = "Formulas.exe";
    }
  }

  const currentMoney = ns.getPlayer().money;
  let financeProgress = "Infrastruktur stabil";

  if (programReserve > 0) {
    if (currentMoney >= programReserve * 0.5) {
      financeProgress = `Sichere $${ns.format.number(programReserve, 0)} (${targetProgramName})`;
    } else {
      programReserve = currentMoney * 0.1; // Weiches Ansparen
      financeProgress = `Aufbau f. ${targetProgramName}`;
    }
  }

  // --- 🏠 HOME UPGRADE SHIELD EVALUIERUNG ---
  if (nextRamCost === Infinity && nextCoreCost === Infinity) {
    patchState(ns, {
      moneyReserve: programReserve,
      financeProgress,
      isRushModeActive: false,
    });
    return false;
  }

  const targetUpgradeCost =
    homeMaxRam < 256 && nextRamCost !== Infinity
      ? nextRamCost
      : Math.min(nextRamCost, nextCoreCost);
  const shieldActive =
    homeMaxRam < 256 || currentMoney >= targetUpgradeCost * 0.2;

  // Der finale Schutzwall ist das Maximum aus benötigtem Programmgeld ODER Serverspeicher-Upgrade
  const finalReserve = Math.max(
    programReserve,
    shieldActive ? targetUpgradeCost : 0,
  );

  patchState(ns, {
    moneyReserve: finalReserve,
    financeProgress:
      programReserve > (shieldActive ? targetUpgradeCost : 0)
        ? financeProgress
        : `Spare auf Home-Upgrade ($${ns.format.number(targetUpgradeCost)})`,
    isRushModeActive: false,
  });

  return shieldActive;
}
