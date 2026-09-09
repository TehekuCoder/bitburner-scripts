import { CompanyName, HacknetServerHashUpgrade, NS } from "@ns";
import { hasSingularity } from "/lib/utils";
import { MEGACORP_COMPANY_TO_FACTION } from "/shared/constants/factions";

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

  const activeTargets: string[] = ["n00dles", "joesguns"];

  while (true) {
    // 1. Hardware/Hacknet automatisch ausbauen
    tryAutoUpgradeHome(ns);

    // 2. Strategie dynamisch ermitteln
    const strategy = autoDetectStrategy(ns);

    // 3. Dynamische Prioritätsliste generieren
    const priorityList = getDynamicPriorityList(ns, strategy, activeTargets);

    // 4. Hashes synchron und ohne künstlichen Delay verbrauchen
    for (const upgrade of priorityList) {
      while (trySpendHashes(ns, upgrade, activeTargets)) {
        // Synchroner Kauf aller verfügbaren Hashes im selben Tick
      }
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
): UpgradePriority[] {
  const list: UpgradePriority[] = [];

  // =========================================================
  // 1. NOTFALL, HASH-CAP GUARD & HARDWARE-SPRINT (Position 0)
  // =========================================================
  const moneyStatus = checkMoneyStatus(ns, criticalMoneyFloor);
  if (moneyStatus.shouldSellForMoney) {
    list.push({ name: "Sell for Money" });
  }

  // =========================================================
  // 2. STRATEGIE-SPEZIFISCHE PRIORITÄTEN
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

    case BotStrategy.EARLY_GAME:
    default:
      list.push({ name: "Improve Studying" });
      list.push({ name: "Sell for Money" });
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

  // Fallback: Allgemeines Geld-Abheben
  list.push({ name: "Sell for Money" });

  return list;
}

/**
 * Führt den Hash-Kauf basierend auf der Upgrade-Definition aus.
 */
function trySpendHashes(
  ns: NS,
  upgrade: UpgradePriority,
  activeTargets: string[],
): boolean {
  const hashCost = ns.hacknet.hashCost(upgrade.name);
  if (ns.hacknet.numHashes() < hashCost) {
    return false;
  }

  // Fall 1: Explizites Custom-Target (z. B. Firmenname für Company Favor)
  if (upgrade.customTarget) {
    return ns.hacknet.spendHashes(upgrade.name, upgrade.customTarget);
  }

  // Fall 2: Server-spezifisches Upgrade (nach maxMoney sortiert)
  if (upgrade.requiresTarget) {
    const sortedTargets = [...activeTargets].sort(
      (a, b) => ns.getServerMaxMoney(b) - ns.getServerMaxMoney(a),
    );

    for (const target of sortedTargets) {
      if (ns.hacknet.spendHashes(upgrade.name, target)) {
        return true;
      }
    }
    return false;
  }

  // Fall 3: Globales Upgrade ohne Ziel
  return ns.hacknet.spendHashes(upgrade.name);
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

  const player = ns.getPlayer();
  if (player.skills.hacking < 100) {
    return BotStrategy.EARLY_GAME;
  }

  return BotStrategy.MONEY_FARM;
}

export interface MoneyStatus {
  shouldSellForMoney: boolean;
  reason?: string;
}

/**
 * Prüft dynamisch, ob Hashes sofort zu Geld liquidiert werden müssen.
 * Beinhaltet Overflow Guard, Notfall-Geldgrenze und Hardware-Sprint.
 */
export function checkMoneyStatus(
  ns: NS,
  criticalFloor: number = 50_000_000,
): MoneyStatus {
  const currentMoney = ns.getServerMoneyAvailable("home");
  const currentHashes = ns.hacknet.numHashes();
  const maxHashes = ns.hacknet.hashCapacity();

  // 1. Hash-Puffer Überlauf verhindern (>= 95% Kapazität)
  if (maxHashes > 0 && currentHashes >= maxHashes * 0.95) {
    return {
      shouldSellForMoney: true,
      reason: `Hash Cap nahe Max (${ns.format.number(currentHashes)} / ${ns.format.number(maxHashes)})`,
    };
  }

  // 2. Notfall-Geldgrenze unterschritten
  if (currentMoney < criticalFloor) {
    return {
      shouldSellForMoney: true,
      reason: `Notfall: Kontostand (${ns.format.number(currentMoney)}) unter Limit`,
    };
  }

  // 3. Hardware-Upgrade Endspurt (Home RAM / Cores ab 75% der Kosten)
  if (hasSingularity(ns)) {
    try {
      const ramCost = ns.singularity.getUpgradeHomeRamCost();
      const coreCost = ns.singularity.getUpgradeHomeCoresCost();

      const validCosts = [ramCost, coreCost].filter(
        (cost) => Number.isFinite(cost) && cost > 0,
      );

      if (validCosts.length > 0) {
        const nextHardwareCost = Math.min(...validCosts);

        if (
          currentMoney < nextHardwareCost &&
          currentMoney >= nextHardwareCost * 0.75
        ) {
          return {
            shouldSellForMoney: true,
            reason: `Hardware-Sprint: ${ns.format.number(currentMoney)} / ${ns.format.number(nextHardwareCost)} (${ns.format.percent(currentMoney / nextHardwareCost)})`,
          };
        }
      }
    } catch {
      // Fallback bei fehlenden API-Rechten
    }
  }

  return { shouldSellForMoney: false };
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
function tryAutoUpgradeHome(ns: NS): void {
  const money = ns.getServerMoneyAvailable("home");

  if (ns.hacknet.getPurchaseNodeCost() <= money * 0.1) {
    ns.hacknet.purchaseNode();
  }

  const numNodes = ns.hacknet.numNodes();
  for (let i = 0; i < numNodes; i++) {
    if (ns.hacknet.getCoreUpgradeCost(i, 1) <= money * 0.05) {
      ns.hacknet.upgradeCore(i, 1);
    }
    if (ns.hacknet.getRamUpgradeCost(i, 1) <= money * 0.05) {
      ns.hacknet.upgradeRam(i, 1);
    }
    if (ns.hacknet.getLevelUpgradeCost(i, 5) <= money * 0.05) {
      ns.hacknet.upgradeLevel(i, 5);
    }
  }
}