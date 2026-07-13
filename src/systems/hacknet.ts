import { NS, NodeStats } from "@ns";
import { loadBnMults } from "../lib/state.js";
import { loadState } from "../core/state-manager.js";
import { Logger } from "../core/logger.js";

interface HacknetUpgrade {
  type: "Level" | "RAM" | "Core" | "Neuer Node";
  cost: number;
  index?: number;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const h = ns.hacknet;
  const logger = new Logger(ns, "HACKNET", "INFO", "/logs/hacknet.txt");

  const isCappedMode = ns.args.length > 0;
  const maxNodes = (ns.args[0] as number) || 30;
  const maxLevels = (ns.args[1] as number) || Infinity;
  const maxRam = (ns.args[2] as number) || Infinity;
  const maxCores = (ns.args[3] as number) || Infinity;

  const bnMults = loadBnMults(ns);

  if (bnMults.HacknetNodeMoney === 0) {
    logger.warn(
      "🛑 Hacknet-Produktion in diesem BitNode deaktiviert. System schaltet ab.",
    );
    return;
  }

  while (true) {
    const numNodes = h.numNodes();

    let allNodesMaxed = numNodes >= maxNodes;
    for (let i = 0; i < numNodes; i++) {
      const stats = h.getNodeStats(i);
      if (
        stats.level < maxLevels ||
        stats.ram < maxRam ||
        stats.cores < maxCores
      ) {
        allNodesMaxed = false;
        break;
      }
    }

    if (isCappedMode && allNodesMaxed) {
      logger.success(
        "🏁 Alle Nodes haben das Netburners-Limit erreicht. Schalte ab.",
      );
      return;
    }

    const hasFormulas = ns.fileExists("Formulas.exe", "home");
    const hNetMults = ns.getHacknetMultipliers();
    const currentMoney = ns.getServerMoneyAvailable("home");

    const state = loadState(ns);
    const reserve = state?.moneyReserve ?? 0;

    let baseBudgetPercent = currentMoney > 10_000_000_000 ? 0.02 : 0.1;
    const budget = currentMoney * baseBudgetPercent * bnMults.HacknetNodeMoney;

    let bestUpgrade: HacknetUpgrade | null = null;
    let highestROI = -1;

    // 🏆 1. ROI FÜR NEUEN KNOTEN
    if (numNodes < maxNodes) {
      const baseCost = h.getPurchaseNodeCost();

      if (baseCost <= budget && currentMoney - baseCost >= reserve) {
        let targetLvl = 10,
          targetRam = 2,
          targetCores = 1;
        if (numNodes > 0) {
          const node0 = h.getNodeStats(0);
          targetLvl = node0.level;
          targetRam = node0.ram;
          targetCores = node0.cores;
        }

        const targetGain = hasFormulas
          ? ns.formulas.hacknetNodes.moneyGainRate(
              targetLvl,
              targetRam,
              targetCores,
              hNetMults.production,
            )
          : targetLvl * 0.5;

        let estimatedTotalCost = baseCost;
        if (numNodes > 0 && hasFormulas) {
          try {
            estimatedTotalCost += ns.formulas.hacknetNodes.levelUpgradeCost(
              1,
              targetLvl - 1,
              hNetMults.levelCost,
            );
            let currentRamLoop = 2;
            let ramUpgrades = 0;
            while (currentRamLoop < targetRam) {
              ramUpgrades++;
              currentRamLoop *= 2;
            }
            if (ramUpgrades > 0) {
              estimatedTotalCost += ns.formulas.hacknetNodes.ramUpgradeCost(
                2,
                ramUpgrades,
                hNetMults.ramCost,
              );
            }
            if (targetCores > 1) {
              estimatedTotalCost += ns.formulas.hacknetNodes.coreUpgradeCost(
                1,
                targetCores - 1,
                hNetMults.coreCost,
              );
            }
          } catch {
            estimatedTotalCost += baseCost * 2;
          }
        }

        const roi = targetGain / estimatedTotalCost;
        if (roi > highestROI) {
          highestROI = roi;
          bestUpgrade = { type: "Neuer Node", cost: baseCost };
        }
      }
    }

    // ⚙️ 2. ROI FÜR UPGRADES BESTEHENDER KNOTEN
    for (let i = 0; i < numNodes; i++) {
      const node: NodeStats = h.getNodeStats(i);

      const checkROI = (cost: number, newGain: number) => {
        if (cost === Infinity || cost > budget) return false;
        if (currentMoney - cost < reserve) return false;

        const roi = hasFormulas ? (newGain - node.production) / cost : 1 / cost;
        if (roi > highestROI) {
          highestROI = roi;
          return true;
        }
        return false;
      };

      if (node.level < maxLevels) {
        const lvlCost = h.getLevelUpgradeCost(i, 1);
        const nextLvlGain = hasFormulas
          ? ns.formulas.hacknetNodes.moneyGainRate(
              node.level + 1,
              node.ram,
              node.cores,
              hNetMults.production,
            )
          : 0;
        if (checkROI(lvlCost, nextLvlGain))
          bestUpgrade = { type: "Level", index: i, cost: lvlCost };
      }

      if (node.ram < maxRam) {
        const ramCost = h.getRamUpgradeCost(i, 1);
        const nextRamGain = hasFormulas
          ? ns.formulas.hacknetNodes.moneyGainRate(
              node.level,
              node.ram * 2,
              node.cores,
              hNetMults.production,
            )
          : 0;
        if (checkROI(ramCost, nextRamGain))
          bestUpgrade = { type: "RAM", index: i, cost: ramCost };
      }

      if (node.cores < maxCores) {
        const coreCost = h.getCoreUpgradeCost(i, 1);
        const nextCoreGain = hasFormulas
          ? ns.formulas.hacknetNodes.moneyGainRate(
              node.level,
              node.ram,
              node.cores + 1,
              hNetMults.production,
            )
          : 0;
        if (checkROI(coreCost, nextCoreGain))
          bestUpgrade = { type: "Core", index: i, cost: coreCost };
      }
    }

    // 🚀 3. KAUF AUSFÜHREN
    if (bestUpgrade) {
      const { type, index, cost } = bestUpgrade;
      if (type === "Neuer Node") {
        h.purchaseNode();
        // Neue Nodes sind ein Meilenstein -> SUCCESS
        logger.success(
          `🎉 Neuer Hacknet-Node gekauft für $${ns.format.number(cost, 2)}`,
        );
      } else if (index !== undefined) {
        if (type === "Level") h.upgradeLevel(index, 1);
        else if (type === "RAM") h.upgradeRam(index, 1);
        else if (type === "Core") h.upgradeCore(index, 1);

        // Normale Upgrades auf DEBUG herabstufen!
        const indexStr = ` (Node ${index})`;
        logger.debug(
          `Upgrade: ${type}${indexStr} für $${ns.format.number(cost, 2)}`,
        );
      }
      await ns.sleep(50);
    }
  }
}
