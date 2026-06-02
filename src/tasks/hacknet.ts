import { NS, NodeStats } from "@ns";

// Interface für Typsicherheit bei den Upgrade-Optionen
interface HacknetUpgrade {
  type: "Level" | "RAM" | "Core" | "Neuer Node";
  cost: number;
  index?: number;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const h = ns.hacknet;
  
  // Formulas-Check
  if (!ns.fileExists("Formulas.exe", "home")) {
    ns.tprint("❌ HACKNET-ERROR: Formulas.exe fehlt auf dem Home-Server.");
    return;
  }

  const f = ns.formulas.hacknetNodes;

  while (true) {
    const mults = ns.getHacknetMultipliers().production;
    const currentMoney = ns.getServerMoneyAvailable("home");
    const budget = currentMoney * 0.1; // Nutzt 10% des Barbestands

    let bestUpgrade: HacknetUpgrade | null = null;
    let highestROI = 0;

    // 1. ROI für einen NEUEN Knoten prüfen
    if (h.numNodes() < 25) {
      const cost = h.getPurchaseNodeCost();
      const gain = f.moneyGainRate(1, 1, 1, mults);
      const roi = gain / cost;
      if (roi > highestROI) {
        highestROI = roi;
        bestUpgrade = { type: "Neuer Node", cost: cost };
      }
    }

    // 2. ROI für UPGRADES bestehender Knoten prüfen
    for (let i = 0; i < h.numNodes(); i++) {
      const node: NodeStats = h.getNodeStats(i);

      // Helfer für ROI-Vergleich
      const checkROI = (cost: number, newGain: number) => {
        if (cost === Infinity) return;
        const roi = (newGain - node.production) / cost;
        if (roi > highestROI) {
          highestROI = roi;
          return true;
        }
        return false;
      };

      // Level
      const lvlCost = h.getLevelUpgradeCost(i, 1);
      if (checkROI(lvlCost, f.moneyGainRate(node.level + 1, node.ram, node.cores, mults))) {
        bestUpgrade = { type: "Level", index: i, cost: lvlCost };
      }

      // RAM
      const ramCost = h.getRamUpgradeCost(i, 1);
      if (checkROI(ramCost, f.moneyGainRate(node.level, node.ram * 2, node.cores, mults))) {
        bestUpgrade = { type: "RAM", index: i, cost: ramCost };
      }

      // Cores
      const coreCost = h.getCoreUpgradeCost(i, 1);
      if (checkROI(coreCost, f.moneyGainRate(node.level, node.ram, node.cores + 1, mults))) {
        bestUpgrade = { type: "Core", index: i, cost: coreCost };
      }
    }

    // 3. Bestes Upgrade ausführen
    if (bestUpgrade && bestUpgrade.cost <= budget) {
      const { type, index, cost } = bestUpgrade;

      if (type === "Neuer Node") h.purchaseNode();
      else if (index !== undefined) {
        if (type === "Level") h.upgradeLevel(index, 1);
        else if (type === "RAM") h.upgradeRam(index, 1);
        else if (type === "Core") h.upgradeCore(index, 1);
      }

      const indexStr = index !== undefined ? ` (Node ${index})` : "";
      ns.print(`Gekauft: ${type}${indexStr} für $${ns.format.number(cost, 2)}`);
      await ns.sleep(100);
    } else {
      ns.print("Hacknet: Keine effizienten Upgrades bezahlbar. Standby...");
      await ns.sleep(30000);
    }
  }
}