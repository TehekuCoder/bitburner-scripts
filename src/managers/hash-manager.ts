import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { loadState, loadBatcherState } from "/lib/state.js";
import { BotStrategy } from "/lib/types/strategy.js";
import {
  hasSingularity,
  hasCorporation,
  hasbladeburner,
  formatMoney,
  loadBnMults,
} from "/lib/utils.js";

type HashUpgradeName =
  | "Sell for Money"
  | "Sell for Corporation Funds"
  | "Reduce Minimum Security"
  | "Increase Maximum Money"
  | "Improve Studying"
  | "Improve Gym Training"
  | "Exchange for Corporation Research"
  | "Exchange for Bladeburner Rank"
  | "Exchange for Bladeburner SP"
  | "Generate Coding Contract";

interface UpgradePriority {
  name: HashUpgradeName;
  requiresTarget?: boolean;
  maxLevel?: number;
  minReserveHashes?: number;
  condition?: (ns: NS) => boolean;
}

function getHighestValueServer(ns: NS): string | null {
  const visited = new Set<string>(["home"]);
  const queue: string[] = ["home"];
  let maxMoney = 0;
  let bestServer: string | null = null;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = ns.scan(current);

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);

      if (
        neighbor.startsWith("hacknet-server") ||
        neighbor.startsWith("hacknet-node")
      ) {
        continue;
      }

      if (ns.hasRootAccess(neighbor)) {
        const money = ns.getServerMaxMoney(neighbor);
        if (money > maxMoney) {
          maxMoney = money;
          bestServer = neighbor;
        }
      }
    }
  }
  return bestServer;
}

function getActiveBatcherTargets(ns: NS): string[] {
  const batcherState = loadBatcherState(ns);
  if (
    batcherState?.batcherTargetsSummary &&
    batcherState.batcherTargetsSummary.length > 0
  ) {
    return batcherState.batcherTargetsSummary.map((t) => t.target);
  }

  if (batcherState?.batcherTarget) {
    return [batcherState.batcherTarget];
  }

  const fallback = getHighestValueServer(ns);
  return fallback ? [fallback] : [];
}

function getHardwareUpgradeCost(ns: NS): number | null {
  if (!hasSingularity(ns)) return null;

  try {
    const ramCost = ns.singularity.getUpgradeHomeRamCost();
    const coreCost = ns.singularity.getUpgradeHomeCoresCost();
    const validCosts: number[] = [];

    if (Number.isFinite(ramCost) && ramCost > 0) validCosts.push(ramCost);
    if (Number.isFinite(coreCost) && coreCost > 0) validCosts.push(coreCost);

    return validCosts.length > 0 ? Math.min(...validCosts) : null;
  } catch {
    return null;
  }
}

function tryAutoUpgradeHome(ns: NS, logger: Logger): void {
  if (!hasSingularity(ns)) return;

  try {
    const money = ns.getServerMoneyAvailable("home");

    const ramCost = ns.singularity.getUpgradeHomeRamCost();
    if (ramCost > 0 && money >= ramCost) {
      if (ns.singularity.upgradeHomeRam()) {
        logger.success(
          `🚀 Home RAM aufgerüstet! Neue Kapazität: ${ns.getServerMaxRam("home")} GB`,
        );
      }
    }

    const coreCost = ns.singularity.getUpgradeHomeCoresCost();
    if (coreCost > 0 && money >= coreCost) {
      if (ns.singularity.upgradeHomeCores()) {
        const cores = ns.getServer("home").cpuCores;
        logger.success(`🚀 Home Cores aufgerüstet! Aktuell: ${cores} Cores`);
      }
    }
  } catch {
    // Ignorieren bei fehlenden Rechten
  }
}

function getDynamicPriorityList(
  ns: NS,
  bnMults: ReturnType<typeof loadBnMults>,
  strategy?: BotStrategy,
): UpgradePriority[] {
  const list: UpgradePriority[] = [];
  const isAugmentationExpensive = bnMults.AugmentationMoneyCost > 2.0;
  const canContractMoney = (bnMults.CodingContractMoney ?? 1) > 0;

  // 1️⃣ STRATEGIE-SPEZIFISCHE HIGH-PRIORITY UPGRADES

  // DOMINION & UNI Modus: Maximaler Boost auf Uni-Studium für XP-Rush
  if (strategy === "DOMINION" || strategy === "UNI") {
    list.push({ name: "Improve Studying" });
  }

  // TRAIN & KILLS Modus: Gym-Training pushen
  if (strategy === "TRAIN" || strategy === "KILLS") {
    list.push({ name: "Improve Gym Training" });
  }

  // BLADEBURNER Modus: SP & Rank generieren
  if (strategy === "BLADEBURNER") {
    list.push({
      name: "Exchange for Bladeburner SP",
      condition: (ns) => hasbladeburner(ns) && ns.bladeburner.inBladeburner(),
    });
    list.push({
      name: "Exchange for Bladeburner Rank",
      condition: (ns) => hasbladeburner(ns) && ns.bladeburner.inBladeburner(),
    });
  }

  // CORP Modus: Research & Capital Injection
  if (strategy === "CORP") {
    list.push({
      name: "Exchange for Corporation Research",
      condition: (ns) => hasCorporation(ns) && ns.corporation.hasCorporation(),
    });
    list.push({
      name: "Sell for Corporation Funds",
      condition: (ns) =>
        hasCorporation(ns) &&
        ns.corporation.hasCorporation() &&
        bnMults.CorporationValuation > 0.1,
    });
  }

  // 2️⃣ GENERELLE HOCHWERTIGE UPGRADES

  // Coding Contracts (sehr hohe Rendite)
  if (canContractMoney) {
    list.push({ name: "Generate Coding Contract" });
  }

  // Teure Augmentations: Geldverkauf nach oben ziehen
  if (isAugmentationExpensive) {
    list.push({ name: "Sell for Money" });
  }

  // Batcher-Server Buffs
  list.push({ name: "Increase Maximum Money", requiresTarget: true });
  list.push({ name: "Reduce Minimum Security", requiresTarget: true });

  // 3️⃣ FALLBACKS & RESTLICHE BUFFS
  list.push({ name: "Improve Studying" });
  list.push({ name: "Improve Gym Training" });
  list.push({ name: "Sell for Money" });

  return list;
}

function trySpendHashes(
  ns: NS,
  upgrade: UpgradePriority,
  targets: string[],
  logger: Logger,
): boolean {
  if (upgrade.condition && !upgrade.condition(ns)) return false;

  const currentHashes = ns.hacknet.numHashes();
  const reserve = upgrade.minReserveHashes ?? 0;

  if (currentHashes <= reserve) return false;

  if (upgrade.maxLevel !== undefined) {
    const currentLevel = ns.hacknet.getHashUpgradeLevel(upgrade.name);
    if (currentLevel >= upgrade.maxLevel) return false;
  }

  const cost = ns.hacknet.hashCost(upgrade.name);
  if (currentHashes < cost) return false;

  if (upgrade.requiresTarget) {
    for (const target of targets) {
      if (ns.hacknet.spendHashes(upgrade.name, target)) {
        logger.info(
          `⚡ Hash-Buff angewendet: [${upgrade.name}] ➔ ${target}`,
          target,
        );
        return true;
      }
    }
    return false;
  }

  if (ns.hacknet.spendHashes(upgrade.name)) {
    if (upgrade.name === "Generate Coding Contract") {
      logger.success(`📜 Coding Contract via Hashes generiert!`);
    } else {
      logger.info(`💸 Hash-Upgrade gekauft: [${upgrade.name}]`);
    }
    return true;
  }

  return false;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Hash-Manager");
  const bnMults = loadBnMults(ns);

  const criticalMoneyFloor =
    typeof ns.args[0] === "number" ? ns.args[0] : 50_000_000;

  let lastLoggedHardwareGoal = 0;
  let lastLiquidationLogTime = 0;

  logger.info(
    `🟢 Hash-Manager Daemon gestartet (Notfall-Boden: ${formatMoney(criticalMoneyFloor)}).`,
  );

  while (true) {
    const capacity = ns.hacknet.hashCapacity();
    const currentHashes = ns.hacknet.numHashes();

    if (capacity === 0) {
      await ns.sleep(10000);
      continue;
    }

    // 1. Home-Upgrades via Singularity versuchen
    tryAutoUpgradeHome(ns, logger);

    const currentMoney = ns.getServerMoneyAvailable("home");
    const hardwareCost = getHardwareUpgradeCost(ns);

    if (hardwareCost && hardwareCost !== lastLoggedHardwareGoal) {
      logger.debug(
        `🎯 Nächstes Home-Hardware Ziel: ${formatMoney(hardwareCost)}`,
      );
      lastLoggedHardwareGoal = hardwareCost;
    }

    // 2. PRÜFUNG: Notfall-Liquidation
    const isCriticalMoney = currentMoney < criticalMoneyFloor;
    const isCloseToHardware =
      hardwareCost !== null &&
      currentMoney < hardwareCost &&
      currentMoney >= hardwareCost * 0.75;

    if (isCriticalMoney || isCloseToHardware) {
      const sellCost = ns.hacknet.hashCost("Sell for Money");
      let soldCount = 0;

      while (ns.hacknet.numHashes() >= sellCost) {
        if (ns.hacknet.spendHashes("Sell for Money")) {
          soldCount++;
        } else {
          break;
        }
      }

      const now = Date.now();
      if (soldCount > 0 && now - lastLiquidationLogTime > 30000) {
        const reason = isCriticalMoney
          ? `Kontostand (${formatMoney(currentMoney)}) unter Notfall-Limit (${formatMoney(criticalMoneyFloor)})`
          : `Endspurt für Hardware-Upgrade (${formatMoney(currentMoney)} / ${formatMoney(hardwareCost!)})`;

        logger.warn(
          `🚨 Liquidation: ${reason}. ${soldCount}x Hashes zu Geld gemacht.`,
        );
        lastLiquidationLogTime = now;
      }
    }

    // 3. REGULÄRE PRIORITÄTEN EVALUIEREN (ab 50% Kapazität)
    if (currentHashes >= capacity * 0.5) {
      const botState = loadState(ns);
      const activeTargets = getActiveBatcherTargets(ns);
      const priorityList = getDynamicPriorityList(
        ns,
        bnMults,
        botState?.strategy,
      );

      for (const upgrade of priorityList) {
        while (trySpendHashes(ns, upgrade, activeTargets, logger)) {
          await ns.sleep(20);
        }
      }
    }

    await ns.sleep(2000);
  }
}