// src/utils/infra-sing-executor.ts

import { NS, ProgramName } from "@ns";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js";
import { patchState } from "../core/state-manager.js";
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

  const currentHacking = ns.getHackingLevel();

  // 1. Programme kaufen
  handleProgramPurchases(ns, logger, currentHacking);

  // 2. Home Server Upgrades durchführen
  handleHomeServerPurchases(ns, logger);

  // 3. Home-Shield berechnen und in den State schreiben
  const shieldActive = checkHomeUpgradeShield(ns);

  // 4. Aktuelle CPU-Kerne erfassen
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

function handleHomeServerPurchases(ns: NS, logger: Logger): void {
  const sing = ns.singularity;
  const homeMaxRam = ns.getServerMaxRam("home");
  
  // 🟢 FIX: Flacher Puffer. Verhindert, dass das Skript bei exaktem Kontostand blockiert.
  const safetyBuffer = 200_000; 
  let availableMoney = ns.getPlayer().money - safetyBuffer;
  if (availableMoney <= 0) return;

  const ramCost = sing.getUpgradeHomeRamCost();
  const coreCost = sing.getUpgradeHomeCoresCost();

  // 🚨 STRATEGISCHE PRIORISIERUNG: Unter 256GB RAM haben Cores striktes Kaufverbot,
  // es sei denn, wir können uns BEIDES gleichzeitig leisten. RAM hat Vorrang für den Batcher!
  if (homeMaxRam < 256) {
    if (ramCost !== Infinity && availableMoney >= ramCost) {
      if (sing.upgradeHomeRam()) {
        const newRam = ns.getServerMaxRam("home");
        ns.toast(`Home RAM erweitert!`, "success");
        logger.success(`🏠 Home-RAM Upgrade durchgeführt. Neuer Wert: ${ns.format.ram(newRam)}`);
        availableMoney -= ramCost;
      }
    }
    
    // Cores im Early-Game nur kaufen, wenn das RAM-Upgrade dadurch nicht verzögert wird
    if (coreCost !== Infinity && availableMoney >= coreCost) {
      if (ramCost === Infinity || (availableMoney - coreCost) >= ramCost) {
        if (sing.upgradeHomeCores()) {
          ns.toast(`Home Cores erweitert!`, "success");
          logger.success("🏠 Home-Cores Upgrade durchgeführt.");
        }
      }
    }
  } else {
    // Late-Game Balancing: Kaufe was bezahlbar ist, RAM bevorzugt
    if (ramCost !== Infinity && availableMoney >= ramCost) {
      if (sing.upgradeHomeRam()) {
        const newRam = ns.getServerMaxRam("home");
        ns.toast(`Home RAM erweitert!`, "success");
        logger.success(`🏠 Home-RAM Upgrade durchgeführt. Neuer Wert: ${ns.format.ram(newRam)}`);
        availableMoney -= ramCost;
      }
    }
    if (coreCost !== Infinity && availableMoney >= coreCost) {
      if (sing.upgradeHomeCores()) {
        ns.toast(`Home Cores erweitert!`, "success");
        logger.success("🏠 Home-Cores Upgrade durchgeführt.");
      }
    }
  }
}

function checkHomeUpgradeShield(ns: NS): boolean {
  const sing = ns.singularity;
  const nextRamCost = sing.getUpgradeHomeRamCost();
  const nextCoreCost = sing.getUpgradeHomeCoresCost();
  const homeMaxRam = ns.getServerMaxRam("home");

  if (nextRamCost === Infinity && nextCoreCost === Infinity) {
    patchState(ns, { moneyReserve: 0, isRushModeActive: false });
    return false;
  }

  // Bestimme das strategische Ziel: Unter 256GB blockieren wir ALLES für RAM.
  const targetUpgradeCost = (homeMaxRam < 256 && nextRamCost !== Infinity) 
    ? nextRamCost 
    : Math.min(nextRamCost, nextCoreCost);

  const currentMoney = ns.getPlayer().money;
  const currentServers = ns.cloud.getServerNames();

  // Rush-Mode Evaluierung beibehalten
  const hasFormulas = ns.fileExists("Formulas.exe", "home");
  const hasEligiblePserv = currentServers.some((s) => ns.getServerMaxRam(s) >= 64);
  const isRushMode = hasFormulas && homeMaxRam >= 256 && !hasEligiblePserv && currentServers.length > 0;

  if (isRushMode) {
    patchState(ns, { moneyReserve: 0, isRushModeActive: true });
    return false;
  }

  // 🛑 LOGIK-FIX: Der fehlerhafte P-Server-Vergleich wurde entfernt.
  // Der Shield bleibt jetzt unter 256GB RAM IMMER aktiv, um den Meilenstein zu sichern.
  // Über 256GB greift er, sobald wir 20% des Upgrade-Preises angespart haben.
  const shieldActive = homeMaxRam < 256 || currentMoney >= targetUpgradeCost * 0.2;

  patchState(ns, {
    moneyReserve: shieldActive ? targetUpgradeCost : 0,
    isRushModeActive: false
  });

  return shieldActive;
}