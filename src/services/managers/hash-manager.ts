import { CompanyName, FactionName, HacknetServerHashUpgrade, NS } from "@ns";
import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";
import { BotStrategy } from "/shared/types/strategy.js";
import {
  hasSingularity,
  hasCorporation,
  hasBladeburner,
  formatMoney,
  loadBnMults,
} from "/lib/utils.js";
import { loadBatcherState, loadState } from "/infrastructure/state/state";
import { MEGACORP_COMPANY_TO_FACTION } from "/shared/constants/factions";

// 1. Upgrade-Typ erweitern
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
  | "Generate Coding Contract"
  | "Company Favor";

interface UpgradePriority {
  name: HashUpgradeName;
  requiresTarget?: boolean;
  maxLevel?: number;
  minReserveHashes?: number;
  condition?: (ns: NS) => boolean;
}

// 2. Hilfsfunktion: Bestimme Ziel-Firma für Favor-Kauf
function getTargetCompanyForFavor(ns: NS): CompanyName | null {
  if (!hasSingularity(ns)) return null;

  const player = ns.getPlayer();
  const playerFactions = player.factions;
  const invites = ns.singularity.checkFactionInvitations();

  const currentWork = player.jobs;
  const activeCompanies = Object.keys(currentWork) as CompanyName[];

  for (const company of activeCompanies) {
    const correspondingFaction = MEGACORP_COMPANY_TO_FACTION[company];

    if (
      correspondingFaction &&
      (playerFactions.includes(correspondingFaction) ||
        invites.includes(correspondingFaction))
    ) {
      continue;
    }

    if (!playerFactions.includes("Silhouette" as FactionName)) {
      return company;
    }

    if (correspondingFaction) {
      return company;
    }
  }

  return null;
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
        const newRam = ns.getServerMaxRam("home");
        logger.success(
          `🚀 Home RAM aufgerüstet! Neue Kapazität: ${newRam} GB`,
          undefined,
          { context: { newRam, cost: ramCost } },
        );
      }
    }

    const coreCost = ns.singularity.getUpgradeHomeCoresCost();
    if (coreCost > 0 && money >= coreCost) {
      if (ns.singularity.upgradeHomeCores()) {
        const cores = ns.getServer("home").cpuCores;
        logger.success(
          `🚀 Home Cores aufgerüstet! Aktuell: ${cores} Cores`,
          undefined,
          { context: { cores, cost: coreCost } },
        );
      }
    }
  } catch (err) {
    logger.debug(`Fehler beim automatischen Home-Upgrade: ${String(err)}`);
  }
}

/**
 * Dynamische Prioritätenliste auf Basis von Strategie UND BitNodeMultipliers (bnMults)
 */
function getDynamicPriorityList(
  ns: NS,
  bnMults: ReturnType<typeof loadBnMults>,
  strategy?: BotStrategy,
  isDominionActive?: boolean,
  sleeveGlobalMode?: string,
): UpgradePriority[] {
  const list: UpgradePriority[] = [];
  const reserveBuffer = Math.floor(ns.hacknet.hashCapacity() * 0.2);

  // --- BITNODE MULTIPLIER ANALYSE ---
  const bbRankNerfed = (bnMults.BladeburnerRank ?? 1) < 0.8;
  const bbSkillExpensive = (bnMults.BladeburnerSkillCost ?? 1) > 1.2;
  const corpValuationNerfed = (bnMults.CorporationValuation ?? 1) < 0.5;
  const expGainSlow = (bnMults.ClassGymExpGain ?? 1) < 0.8;
  const companyRepSlow = (bnMults.CompanyWorkRepGain ?? 1) < 0.8;
  const scriptMoneyNerfed =
    (bnMults.ScriptHackMoneyGain ?? 1) < 0.5 ||
    (bnMults.ScriptHackMoney ?? 1) < 0.5;
  const contractMoneyGood = (bnMults.CodingContractMoney ?? 1) > 0;
  const augsExpensive = (bnMults.AugmentationMoneyCost ?? 1) > 1.5;

  const isDominion =
    strategy === "DOMINION" ||
    strategy === "UNI" ||
    isDominionActive === true ||
    sleeveGlobalMode === "DOMINION" ||
    sleeveGlobalMode === "UNI";

  // -------------------------------------------------------------
  // 1️⃣ HIGH-PRIORITY: BLADEBURNER (BN-Multiplikatoren berücksichtigen)
  // -------------------------------------------------------------
  if (strategy === "BLADEBURNER") {
    // Wenn Bladeburner-Rank im BN generft ist, hat Rank-Kauf VORRANG vor SP!
    if (bbRankNerfed) {
      list.push({
        name: "Exchange for Bladeburner Rank",
        condition: (ns) => hasBladeburner(ns) && ns.bladeburner.inBladeburner(),
      });
    }

    list.push({
      name: "Exchange for Bladeburner SP",
      condition: (ns) => hasBladeburner(ns) && ns.bladeburner.inBladeburner(),
    });

    if (!bbRankNerfed) {
      list.push({
        name: "Exchange for Bladeburner Rank",
        condition: (ns) => hasBladeburner(ns) && ns.bladeburner.inBladeburner(),
      });
    }
  }

  // -------------------------------------------------------------
  // 2️⃣ HIGH-PRIORITY: CORPORATION (BN-Multiplikatoren berücksichtigen)
  // -------------------------------------------------------------
  if (hasCorporation(ns) && ns.corporation.hasCorporation()) {
    list.push({
      name: "Exchange for Corporation Research",
      condition: (ns) => hasCorporation(ns) && ns.corporation.hasCorporation(),
    });

    // Wenn Corp-Valuation im BN krass generft ist, ist Corp-Funds-Kauf extrem wichtig für das Überleben
    if (corpValuationNerfed || bnMults.CorporationValuation > 0.1) {
      list.push({
        name: "Sell for Corporation Funds",
        condition: (ns) =>
          hasCorporation(ns) && ns.corporation.hasCorporation(),
      });
    }
  }

  // -------------------------------------------------------------
  // 3️⃣ STRATEGIE & STAT-BUFFS (Studying / Gym)
  // -------------------------------------------------------------
  // Wenn XP-Gewinn im BN verlangsamt ist, priorisieren wir Buffs früher!
  if (isDominion || expGainSlow) {
    list.push({ name: "Improve Studying" });
  }

  if (
    strategy === "TRAIN" ||
    strategy === "KILLS" ||
    (expGainSlow && strategy === "BLADEBURNER")
  ) {
    list.push({ name: "Improve Gym Training" });
  }

  // -------------------------------------------------------------
  // 4️⃣ COMPANY / MEGACORP FAVOR
  // -------------------------------------------------------------
  if (strategy === "COMPANY" || companyRepSlow) {
    const targetCompany = getTargetCompanyForFavor(ns);
    if (targetCompany) {
      list.push({
        name: "Company Favor",
        requiresTarget: true,
      });
    }
    if (strategy === "COMPANY") {
      list.push({ name: "Improve Studying", minReserveHashes: reserveBuffer });
    }
  }

  // -------------------------------------------------------------
  // 5️⃣ GELD-GENERIERUNG (Contracts vs. Liquidation vs. Server Buffs)
  // -------------------------------------------------------------
  // Wenn Hacking im BN stark generft ist -> Contracts & Hash-Liquidation priorisieren
  if (scriptMoneyNerfed && contractMoneyGood) {
    list.push({
      name: "Generate Coding Contract",
      minReserveHashes: reserveBuffer,
    });
    list.push({ name: "Sell for Money", minReserveHashes: reserveBuffer });
  } else if (contractMoneyGood) {
    list.push({
      name: "Generate Coding Contract",
      minReserveHashes: reserveBuffer,
    });
  }

  if (augsExpensive) {
    list.push({ name: "Sell for Money", minReserveHashes: reserveBuffer });
  }

  // -------------------------------------------------------------
  // 6️⃣ BATCHER-TARGET BUFFS (Server Money & Security)
  // -------------------------------------------------------------
  // Bringt primär etwas, wenn Hacking-Geld im BN nicht völlig zerstört ist
  if (!scriptMoneyNerfed) {
    list.push({ name: "Increase Maximum Money", requiresTarget: true });
    list.push({ name: "Reduce Minimum Security", requiresTarget: true });
  }

  // -------------------------------------------------------------
  // 7️⃣ FALLBACKS & RESTLICHE BUFFS
  // -------------------------------------------------------------
  list.push({ name: "Increase Maximum Money", requiresTarget: true });
  list.push({ name: "Reduce Minimum Security", requiresTarget: true });
  list.push({ name: "Improve Studying", minReserveHashes: reserveBuffer });
  list.push({ name: "Improve Gym Training", minReserveHashes: reserveBuffer });
  list.push({ name: "Sell for Money", minReserveHashes: reserveBuffer });

  return list;
}

function trySpendHashes(
  ns: NS,
  upgrade: UpgradePriority,
  targets: string[],
  logger: Logger,
): boolean {
  if (upgrade.condition && !upgrade.condition(ns)) {
    return false;
  }

  const currentHashes = ns.hacknet.numHashes();
  const reserve = upgrade.minReserveHashes ?? 0;

  if (currentHashes <= reserve) {
    return false;
  }

  const upgradeName = upgrade.name as HacknetServerHashUpgrade;

  if (upgrade.maxLevel !== undefined) {
    const currentLevel = ns.hacknet.getHashUpgradeLevel(upgradeName);
    if (currentLevel >= upgrade.maxLevel) {
      return false;
    }
  }

  const cost = ns.hacknet.hashCost(upgradeName);
  if (currentHashes < cost) {
    return false;
  }

  if (upgrade.requiresTarget) {
    for (const target of targets) {
      if (ns.hacknet.spendHashes(upgradeName, target)) {
        const remainingHashes = ns.hacknet.numHashes();
        const currentLevel = ns.hacknet.getHashUpgradeLevel(upgradeName);
        logger.info(
          `⚡ Hash-Buff angewendet: [${upgrade.name}] ➔ ${target}`,
          target,
          {
            context: {
              upgrade: upgrade.name,
              target,
              cost,
              remainingHashes,
              level: currentLevel,
            },
          },
        );
        return true;
      }
    }
    return false;
  }

  if (ns.hacknet.spendHashes(upgradeName)) {
    const remainingHashes = ns.hacknet.numHashes();
    if (upgrade.name === "Generate Coding Contract") {
      logger.success(`📜 Coding Contract via Hashes generiert!`, undefined, {
        context: { cost, remainingHashes },
      });
    } else {
      logger.info(`💸 Hash-Upgrade gekauft: [${upgrade.name}]`, undefined, {
        context: { upgrade: upgrade.name, cost, remainingHashes },
      });
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
    undefined,
    { context: { criticalMoneyFloor } },
  );

  while (true) {
    const capacity = ns.hacknet.hashCapacity();

    if (capacity === 0) {
      await ns.sleep(10000);
      continue;
    }

    tryAutoUpgradeHome(ns, logger);

    const botState = loadState(ns);
    const activeTargets = getActiveBatcherTargets(ns);
    const priorityList = getDynamicPriorityList(
      ns,
      bnMults,
      botState?.strategy,
      botState?.isDominionActive,
      botState?.sleeveGlobalMode,
    );

    for (const upgrade of priorityList) {
      while (trySpendHashes(ns, upgrade, activeTargets, logger)) {
        await ns.sleep(20);
      }
    }

    const currentMoney = ns.getServerMoneyAvailable("home");
    const hardwareCost = getHardwareUpgradeCost(ns);

    if (hardwareCost && hardwareCost !== lastLoggedHardwareGoal) {
      logger.debug(
        `🎯 Nächstes Home-Hardware Ziel: ${formatMoney(hardwareCost)}`,
        undefined,
        { context: { hardwareCost, currentMoney } },
      );
      lastLoggedHardwareGoal = hardwareCost;
    }

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
          undefined,
          {
            context: {
              soldCount,
              earnedMoney: soldCount * 1_000_000,
              currentMoney,
              isCriticalMoney,
              isCloseToHardware,
            },
          },
        );
        lastLiquidationLogTime = now;
      }
    }

    await ns.sleep(2000);
  }
}
