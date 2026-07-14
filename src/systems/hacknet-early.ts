import { NS } from "@ns";
import { loadBnMults } from "../lib/state.js"; 
import { loadState, patchState } from "../core/state-manager.js";
import { Logger } from "../core/logger.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const h = ns.hacknet;
  const logger = new Logger(ns, "HACKNET-EARLY", "INFO", "logs/hacknet-early.txt");

  const isCappedMode = ns.args.length > 0;
  const maxNodes = (ns.args[0] as number) || 15;
  const maxLevels = (ns.args[1] as number) || Infinity;
  const maxRam = (ns.args[2] as number) || Infinity;
  const maxCores = (ns.args[3] as number) || Infinity;

  const bnMults = loadBnMults(ns);

  if (bnMults.HacknetNodeMoney === 0) {
    logger.warn("🛑 Hacknet-Produktion deaktiviert. Exit.");
    patchState(ns, { hacknetProgress: "Deaktiviert (BN)" });
    return;
  }

  logger.info(`⚡ Micro-Hacknet Subsystem aktiv (${isCappedMode ? "CAPPED MODE" : "LOW-RAM NO-FORMULAS"})`);

  while (true) {
    const numNodes = h.numNodes();

    let allNodesMaxed = numNodes >= maxNodes;
    for (let i = 0; i < numNodes; i++) {
      const stats = h.getNodeStats(i);
      if (stats.level < maxLevels || stats.ram < maxRam || stats.cores < maxCores) {
        allNodesMaxed = false;
        break;
      }
    }

    if (isCappedMode && allNodesMaxed) {
      logger.success("🏁 Netburners-Minimum erreicht. Schalte System ab.");
      patchState(ns, { hacknetProgress: "Capped & Maxed" });
      return;
    }

    const currentMoney = ns.getServerMoneyAvailable("home");
    const state = loadState(ns);
    const reserve = state?.moneyReserve ?? 0;
    
    let baseBudget = currentMoney > 20_000_000 ? currentMoney * 0.1 : currentMoney * 0.35;
    const budget = baseBudget * bnMults.HacknetNodeMoney;

    let bestCost = Infinity;
    let purchaseType: "Level" | "RAM" | "Core" | "NewNode" | null = null;
    let targetIndex = -1;

    if (numNodes < maxNodes) {
      const nodeCost = h.getPurchaseNodeCost();
      if (nodeCost <= budget && currentMoney - nodeCost >= reserve && nodeCost < bestCost) {
        bestCost = nodeCost;
        purchaseType = "NewNode";
      }
    }

    for (let i = 0; i < numNodes; i++) {
      const stats = h.getNodeStats(i);

      if (stats.level < maxLevels) {
        const lvlCost = h.getLevelUpgradeCost(i, 1);
        if (lvlCost <= budget && currentMoney - lvlCost >= reserve && lvlCost < bestCost) {
          bestCost = lvlCost;
          purchaseType = "Level";
          targetIndex = i;
        }
      }
      if (stats.ram < maxRam) {
        const ramCost = h.getRamUpgradeCost(i, 1);
        if (ramCost <= budget && currentMoney - ramCost >= reserve && ramCost < bestCost) {
          bestCost = ramCost;
          purchaseType = "RAM";
          targetIndex = i;
        }
      }
      if (stats.cores < maxCores) {
        const coreCost = h.getCoreUpgradeCost(i, 1);
        if (coreCost <= budget && currentMoney - coreCost >= reserve && coreCost < bestCost) {
          bestCost = coreCost;
          purchaseType = "Core";
          targetIndex = i;
        }
      }
    }

    if (purchaseType !== null) {
      const indexStr = targetIndex !== -1 ? ` (Node ${targetIndex})` : "";
      patchState(ns, { hacknetProgress: `Kauf: ${purchaseType}${indexStr}` });

      if (purchaseType === "NewNode") {
        h.purchaseNode();
        logger.success(`Neuer Node gekauft für $${ns.format.number(bestCost)}`);
      } else {
        if (purchaseType === "Level") h.upgradeLevel(targetIndex, 1);
        if (purchaseType === "RAM") h.upgradeRam(targetIndex, 1);
        if (purchaseType === "Core") h.upgradeCore(targetIndex, 1);
        logger.debug(`Node ${targetIndex}: ${purchaseType}-Upgrade für $${ns.format.number(bestCost)}`);
      }
      await ns.sleep(100);
    } else {
      // 🕵️ SCOUT-LOGIK: Wenn kein Kauf getätigt wurde, suche den genauen Grund
      let cheapestCost = Infinity;
      let cheapestDesc = "";

      if (numNodes < maxNodes) {
        const nodeCost = h.getPurchaseNodeCost();
        if (nodeCost < cheapestCost) {
          cheapestCost = nodeCost;
          cheapestDesc = "Neuer Node";
        }
      }

      for (let i = 0; i < numNodes; i++) {
        const stats = h.getNodeStats(i);
        if (stats.level < maxLevels) {
          const c = h.getLevelUpgradeCost(i, 1);
          if (c < cheapestCost) { cheapestCost = c; cheapestDesc = `N${i} Lvl`; }
        }
        if (stats.ram < maxRam) {
          const c = h.getRamUpgradeCost(i, 1);
          if (c < cheapestCost) { cheapestCost = c; cheapestDesc = `N${i} RAM`; }
        }
        if (stats.cores < maxCores) {
          const c = h.getCoreUpgradeCost(i, 1);
          if (c < cheapestCost) { cheapestCost = c; cheapestDesc = `N${i} Core`; }
        }
      }

      let statusMsg = "Maxed Out";
      if (cheapestCost !== Infinity) {
        if (currentMoney - cheapestCost < reserve) {
          statusMsg = `Reserve Block ($${ns.format.number(cheapestCost, 1)})`;
        } else if (cheapestCost > budget) {
          statusMsg = `Spare auf ${cheapestDesc} ($${ns.format.number(cheapestCost, 1)})`;
        }
      }

      patchState(ns, { hacknetProgress: statusMsg });
      await ns.sleep(isCappedMode ? 5000 : 15000);
    }
  }
}