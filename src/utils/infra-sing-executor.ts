import { NS, ProgramName } from "@ns";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js";
import { patchState, loadState } from "../core/state-manager.js";
import { Logger } from "../core/logger.js";

const TARGET_PROGRAMS = [
  "BruteSSH.exe",
  "FTPCrack.exe",
  "relaySMTP.exe",
  "HTTPWorm.exe",
  "DarkscapeNavigator.exe",
  "SQLInject.exe",
  "Formulas.exe",
] as const;

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Infra-Sing", "INFO");
  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;

  const player = ns.getPlayer();
  const currentHacking = ns.getHackingLevel();
  const homeCostMultiplier = bnMults.HomeComputerRamCost ?? 1.0;
  const baseReserve = homeCostMultiplier > 2 ? 2_000_000 : 500_000;
  const dynamicReserve = Math.max(baseReserve, player.money * 0.05);

  // 1. Programme kaufen
  handleProgramPurchases(ns, logger, currentHacking);

  // 2. Home Server Upgrades durchführen
  handleHomeServerPurchases(ns, dynamicReserve, logger);

  // 3. Home-Shield berechnen und in den State schreiben
  const shieldActive = checkHomeUpgradeShield(ns);

  // 4. Aktuelle CPU-Kerne erfassen (kostet ns.getServer -> 2GB)
  const homeCores = ns.getServer("home").cpuCores;

  patchState(ns, {
    isHomePrioritized: shieldActive,
    homeCores: homeCores
  });
}

function handleProgramPurchases(ns: NS, logger: Logger, currentHacking: number): void {
  const sing = ns.singularity;
  if (!ns.hasTorRouter() && ns.getPlayer().money >= 200_000 && currentHacking >= 40) {
    if (sing.purchaseTor()) {
      logger.success("📡 TOR-Router erfolgreich erworben.");
    }
  }

  if (ns.hasTorRouter()) {
    const programGates: Record<string, number> = {
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
            logger.success(`💾 Software erfolgreich lizenziert: ${prog}`);
          }
        }
      }
    }
  }
}

function handleHomeServerPurchases(ns: NS, reserveMoney: number, logger: Logger): void {
  const sing = ns.singularity;
  let availableMoney = ns.getPlayer().money - reserveMoney;
  if (availableMoney <= 0) return;

  const ramCost = sing.getUpgradeHomeRamCost();
  if (ramCost !== Infinity && availableMoney >= ramCost) {
    if (sing.upgradeHomeRam()) {
      const newRam = ns.getServerMaxRam("home");
      ns.toast(`Home RAM erweitert!`, "success");
      logger.success(`🏠 Home-RAM Upgrade durchgeführt. Neuer Wert: ${ns.format.ram(newRam)}`);
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
  const sing = ns.singularity;
  const nextRamCost = sing.getUpgradeHomeRamCost();
  const nextCoreCost = sing.getUpgradeHomeCoresCost();

  if (nextRamCost === Infinity && nextCoreCost === Infinity) return false;

  const currentMoney = ns.getPlayer().money;
  const minHomeCost = Math.min(nextRamCost, nextCoreCost);

  const currentServers = ns.cloud.getServerNames();
  const currentMinRam = currentServers.length > 0
    ? Math.min(...currentServers.map((s) => ns.getServerMaxRam(s)))
    : 8;

  const nextPservUpgradeCost = ns.cloud.getServerCost(currentMinRam * 2) - ns.cloud.getServerCost(currentMinRam);

  const homeMaxRam = ns.getServerMaxRam("home");
  const hasFormulas = ns.fileExists("Formulas.exe", "home");
  const hasEligiblePserv = currentServers.some((s) => ns.getServerMaxRam(s) >= 64);
  const isRushMode = hasFormulas && homeMaxRam >= 256 && !hasEligiblePserv && currentServers.length > 0;

  if (isRushMode) {
    patchState(ns, { moneyReserve: 0, isRushModeActive: true });
    return false;
  }

  const shieldActive = currentMoney >= minHomeCost * 0.5 && minHomeCost < nextPservUpgradeCost * 5;

  patchState(ns, {
    moneyReserve: shieldActive ? minHomeCost : 0,
    isRushModeActive: false
  });

  return shieldActive;
}