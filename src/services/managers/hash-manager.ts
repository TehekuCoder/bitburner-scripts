import { CompanyName, HacknetServerHashUpgrade, NS } from "@ns";
import { hasBladeburner, hasSingularity } from "/lib/utils";
import { MEGACORP_COMPANY_TO_FACTION } from "/shared/constants/factions";
import { LoggerClient } from "/infrastructure/logging/logger-client";
import { getAllServers } from "/infrastructure/network/network";

export interface UpgradePriority {
  name: HacknetServerHashUpgrade;
  requiresTarget?: boolean;
  /** Spezielles Ziel (z. B. Firmenname für "Company Favor"), falls abweichend von Hostnames */
  customTarget?: string;
}

export enum BotStrategy {
  EARLY_GAME = "EARLY_GAME",
  BN_SPECIFIC = "BN_SPECIFIC",
  CORPORATION = "CORPORATION",
  EXP_FARM = "EXP_FARM",
  MONEY_FARM = "MONEY_FARM",
  DEFAULT = "DEFAULT",
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();

  const logger = new LoggerClient(ns, "HASH-MANAGER");
  logger.info("Hash-Manager Daemon gestartet.");

  let lastStrategy: BotStrategy | null = null;

  while (true) {
    // 1. Hardware/Hacknet automatisch ausbauen
    tryAutoUpgradeHacknet(ns, logger);

    // 2. Strategie dynamisch ermitteln
    const strategy = autoDetectStrategy(ns);
    if (strategy !== lastStrategy) {
      logger.info(`Strategie gewechselt zu: ${strategy}`, undefined, {
        context: { strategy },
      });
      lastStrategy = strategy;
    }

    // 3. Dynamische Prioritätsliste generieren
    const activeTargets = getActiveTargets(ns);
    const priorityList = getDynamicPriorityList(
      ns,
      strategy,
      activeTargets,
      undefined,
      logger,
    );

    // Re-evaluate priorities on the next cycle so rank and SP purchases stop
    // as soon as their current goals are met.
    for (const upgrade of priorityList) {
      trySpendHashes(ns, upgrade, activeTargets, logger);
    }

    await ns.sleep(1000);
  }
}

/**
 * Erstellt die dynamische Prioritätsliste basierend auf dem aktuellen Spielzustand.
 */
export function getDynamicPriorityList(
  ns: NS,
  strategy: BotStrategy,
  activeTargets: string[],
  criticalMoneyFloor?: number,
  logger?: LoggerClient,
): UpgradePriority[] {
  const list: UpgradePriority[] = [];

  // =========================================================
  // 1. GENUINELY EMPTY CASH BALANCE
  // =========================================================
  const moneyStatus = checkMoneyStatus(ns, criticalMoneyFloor);
  if (moneyStatus.emergency) {
    if (moneyStatus.reason && logger) {
      logger.debug(`Liquidierung getriggert: ${moneyStatus.reason}`);
    }
    list.push({ name: "Sell for Money" });
  } else if (moneyStatus.shouldSellForMoney && logger) {
    logger.debug(`Hash-Cap nahe am Limit: ${moneyStatus.reason ?? "unbekannt"}`);
  }

  // Bladeburner rank and skill points are only useful while the player is
  // actively in the division, and rank is only purchased toward the next BlackOp.
  if (hasBladeburner(ns) && ns.bladeburner.inBladeburner()) {
    const nextBlackOp = ns.bladeburner.getNextBlackOp();
    if (nextBlackOp && ns.bladeburner.getRank() < nextBlackOp.rank) {
      list.push({ name: "Exchange for Bladeburner Rank" });
    }

    const skillPoints = ns.bladeburner.getSkillPoints();
    const nextSkillCost = Math.min(
      ...ns.bladeburner
        .getSkillNames()
        .map((skill) => ns.bladeburner.getSkillUpgradeCost(skill))
        .filter((cost) => Number.isFinite(cost) && cost > 0),
    );
    if (Number.isFinite(nextSkillCost) && skillPoints < nextSkillCost) {
      list.push({ name: "Exchange for Bladeburner SP" });
    }
  }

  // =========================================================
  // 2. STRATEGY-SPECIFIC PRIORITIES
  // =========================================================
  switch (strategy) {
    case BotStrategy.CORPORATION:
      list.push({ name: "Exchange for Corporation Research" });
      list.push({ name: "Sell for Corporation Funds" });
      break;

    case BotStrategy.EXP_FARM:
      list.push({ name: "Improve Studying" });
      list.push({ name: "Improve Gym Training" });
      break;

    case BotStrategy.MONEY_FARM:
      list.push({ name: "Reduce Minimum Security", requiresTarget: true });
      list.push({ name: "Increase Maximum Money", requiresTarget: true });
      break;

    case BotStrategy.BN_SPECIFIC:
      if (!hasBladeburner(ns) || !ns.bladeburner.inBladeburner()) {
        list.push({ name: "Reduce Minimum Security", requiresTarget: true });
        list.push({ name: "Increase Maximum Money", requiresTarget: true });
      }
      break;

    case BotStrategy.EARLY_GAME:
    default:
      list.push({ name: "Improve Studying" });
      break;
  }

  // =========================================================
  // 3. COMPANY FAVOR (Gezielter Firmen-Favorit statt Hostname)
  // =========================================================
  const companyTarget = getTargetCompanyForFavor(ns);
  if (companyTarget) {
    list.push({
      name: "Company Favor",
      requiresTarget: false,
      customTarget: companyTarget,
    });
  }

  // This fallback protects against hash-cap overflow without pre-empting
  // strategic goals. A genuinely empty cash balance remains the exception.
  if (!moneyStatus.emergency) list.push({ name: "Sell for Money" });

  return list;
}

/**
 * Führt den Hash-Kauf basierend auf der Upgrade-Definition aus.
 */
function trySpendHashes(
  ns: NS,
  upgrade: UpgradePriority,
  activeTargets: string[],
  logger?: LoggerClient,
): boolean {
  if (!ns.hacknet.getHashUpgrades().includes(upgrade.name)) {
    return false;
  }

  const hashCost = ns.hacknet.hashCost(upgrade.name);
  if (ns.hacknet.numHashes() < hashCost) {
    return false;
  }

  // Fall 1: Explizites Custom-Target (z. B. Firmenname für Company Favor)
  if (upgrade.customTarget) {
    const success = ns.hacknet.spendHashes(upgrade.name, upgrade.customTarget);
    if (success && logger) {
      logger.success(`Upgrade '${upgrade.name}' gekauft für '${upgrade.customTarget}'`, undefined, {
        context: { cost: hashCost, target: upgrade.customTarget },
        tags: ["hash-spend"],
      });
    }
    return success;
  }

  // Fall 2: Server-spezifisches Upgrade (nach maxMoney sortiert)
  if (upgrade.requiresTarget) {
    const sortedTargets = [...activeTargets].sort(
      (a, b) => ns.getServerMaxMoney(b) - ns.getServerMaxMoney(a),
    );

    for (const target of sortedTargets) {
      if (ns.hacknet.spendHashes(upgrade.name, target)) {
        if (logger) {
          logger.success(`Upgrade '${upgrade.name}' auf '${target}' angewendet`, undefined, {
            context: { cost: hashCost, target },
            tags: ["hash-spend"],
          });
        }
        return true;
      }
    }
    return false;
  }

  // Fall 3: Globales Upgrade ohne Ziel
  const success = ns.hacknet.spendHashes(upgrade.name);
  if (success && logger) {
    logger.success(`Upgrade '${upgrade.name}' gekauft`, undefined, {
      context: { cost: hashCost },
      tags: ["hash-spend"],
    });
  }
  return success;
}

// =========================================================
// HELPER & CHECK-FUNKTIONEN
// =========================================================

/**
 * Ermittelt automatisch die beste Strategie basierend auf dem Spielfortschritt.
 */
export function autoDetectStrategy(ns: NS): BotStrategy {
  if (ns.corporation?.hasCorporation?.()) {
    return BotStrategy.CORPORATION;
  }

  if (hasBladeburner(ns) && ns.bladeburner.inBladeburner()) {
    return BotStrategy.BN_SPECIFIC;
  }

  const player = ns.getPlayer();
  if (player.skills.hacking < 100) {
    return BotStrategy.EARLY_GAME;
  }

  return BotStrategy.MONEY_FARM;
}

export interface MoneyStatus {
  shouldSellForMoney: boolean;
  emergency?: boolean;
  reason?: string;
}

/**
 * Prüft dynamisch, ob Hashes sofort zu Geld liquidiert werden müssen.
 * Erkennt Hash-Cap-Überlauf und eine tatsächlich leere Geldreserve.
 */
export function checkMoneyStatus(
  ns: NS,
  criticalFloor: number = 0,
): MoneyStatus {
  const currentMoney = ns.getServerMoneyAvailable("home");
  const currentHashes = ns.hacknet.numHashes();
  const maxHashes = ns.hacknet.hashCapacity();

  // A temporary shortage is not enough evidence; only near-zero liquidity is
  // treated as an emergency that may pre-empt strategic spending.
  if (currentMoney <= Math.max(1, criticalFloor)) {
    return {
      shouldSellForMoney: true,
      emergency: true,
      reason: `Kein unmittelbar verfügbares Geld (${ns.format.number(currentMoney)})`,
    };
  }

  // Hash capacity is a real deadline: unused production is lost at the cap.
  if (maxHashes > 0 && currentHashes >= maxHashes * 0.95) {
    return {
      shouldSellForMoney: true,
      emergency: false,
      reason: `Hash Cap nahe Max (${ns.format.number(currentHashes)} / ${ns.format.number(maxHashes)})`,
    };
  }

  return { shouldSellForMoney: false };
}

function getActiveTargets(ns: NS): string[] {
  const playerSkill = ns.getHackingLevel();
  const purchasedServers = new Set(ns.cloud.getServerNames());

  return getAllServers(ns)
    .filter((server) => {
      if (
        server === "home" ||
        purchasedServers.has(server) ||
        server.startsWith("hacknet-") ||
        !ns.hasRootAccess(server)
      ) {
        return false;
      }
      const info = ns.getServer(server);
      return (
        (info.requiredHackingSkill ?? 0) <= playerSkill &&
        (info.moneyMax ?? 0) > 0
      );
    })
    .sort((a, b) => ns.getServerMaxMoney(b) - ns.getServerMaxMoney(a))
    .slice(0, 2);
}

/**
 * Ermittelt die beste Firma für den Hash-Kauf "Company Favor".
 * Priorisiert Firmen, deren Fraktion noch nicht freigeschaltet wurde.
 */
export function getTargetCompanyForFavor(ns: NS): CompanyName | null {
  if (!hasSingularity(ns)) return null;

  const player = ns.getPlayer();
  const playerFactions = new Set<string>(player.factions);
  const invites = new Set<string>(ns.singularity.checkFactionInvitations());

  const activeJobs = Object.keys(player.jobs) as CompanyName[];
  if (activeJobs.length === 0) return null;

  for (const company of activeJobs) {
    const correspondingFaction = MEGACORP_COMPANY_TO_FACTION[company];

    if (
      correspondingFaction &&
      (playerFactions.has(correspondingFaction) ||
        invites.has(correspondingFaction))
    ) {
      continue;
    }

    if (!playerFactions.has("Silhouette") && !invites.has("Silhouette")) {
      return company;
    }

    if (correspondingFaction) {
      return company;
    }
  }

  return null;
}

/**
 * Kauft automatisch Hacknet-Nodes und Upgrades, solange der Preis
 * einen Bruchteil des aktuellen Barvermögens nicht übersteigt.
 */
function tryAutoUpgradeHacknet(ns: NS, logger?: LoggerClient): void {
  const startingMoney = ns.getServerMoneyAvailable("home");
  let budget = startingMoney * 0.1;

  const tryPurchase = (
    cost: number,
    purchase: () => boolean,
    onSuccess: () => void,
  ): void => {
    if (
      !Number.isFinite(cost) ||
      cost <= 0 ||
      cost > budget ||
      cost > ns.getServerMoneyAvailable("home")
    ) {
      return;
    }
    if (purchase()) {
      budget -= cost;
      onSuccess();
    }
  };

  const nodeCost = ns.hacknet.getPurchaseNodeCost();
  let purchasedNodeIndex = -1;
  tryPurchase(
    nodeCost,
    () => {
      purchasedNodeIndex = ns.hacknet.purchaseNode();
      return purchasedNodeIndex !== -1;
    },
    () => {
      if (logger) {
        logger.info(
          `Neuer Hacknet-Node gekauft (Index: ${purchasedNodeIndex})`,
          undefined,
          {
            context: { nodeIndex: purchasedNodeIndex },
            tags: ["hardware-buy"],
          },
        );
      }
    },
  );

  const numNodes = ns.hacknet.numNodes();
  const maxHashes = ns.hacknet.hashCapacity();
  const currentHashes = ns.hacknet.numHashes();
  const totalHashRate = Array.from({ length: numNodes }, (_, i) =>
    ns.hacknet.getNodeStats(i),
  ).reduce((sum, node) => sum + node.production, 0);
  const cacheNeeded =
    maxHashes > 0 &&
    (currentHashes >= maxHashes * 0.8 ||
      (totalHashRate > 0 && maxHashes / totalHashRate < 60));

  for (let i = 0; i < numNodes; i++) {
    if (cacheNeeded) {
      const cacheCost = ns.hacknet.getCacheUpgradeCost(i, 1);
      tryPurchase(cacheCost, () => ns.hacknet.upgradeCache(i, 1), () => {
        logger?.debug(`Node ${i}: Cache-Upgrade gekauft`, undefined, {
          context: { node: i },
        });
      });
    }

    const coreCost = ns.hacknet.getCoreUpgradeCost(i, 1);
    tryPurchase(coreCost, () => ns.hacknet.upgradeCore(i, 1), () => {
      logger?.debug(`Node ${i}: Core-Upgrade gekauft`, undefined, {
        context: { node: i },
      });
    });

    const ramCost = ns.hacknet.getRamUpgradeCost(i, 1);
    tryPurchase(ramCost, () => ns.hacknet.upgradeRam(i, 1), () => {
      logger?.debug(`Node ${i}: RAM-Upgrade gekauft`, undefined, {
        context: { node: i },
      });
    });

    const levelCost = ns.hacknet.getLevelUpgradeCost(i, 5);
    tryPurchase(levelCost, () => ns.hacknet.upgradeLevel(i, 5), () => {
      logger?.debug(`Node ${i}: Level +5 gekauft`, undefined, {
        context: { node: i },
      });
    });
  }
}