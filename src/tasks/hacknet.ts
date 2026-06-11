import { NS, NodeStats } from "@ns";

interface HacknetUpgrade {
  type: "Level" | "RAM" | "Core" | "Neuer Node";
  cost: number;
  index?: number;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const h = ns.hacknet;

  while (true) {
    // Dynamischer Formulas-Check bei JEDEM Durchlauf (erlaubt nahtlosen Wechsel)
    const hasFormulas = ns.fileExists("Formulas.exe", "home");
    
    const mults = ns.getHacknetMultipliers().production;
    const currentMoney = ns.getServerMoneyAvailable("home");
    
    // Budget-Zuweisung: 10% des Barbestands
    const budget = currentMoney * 0.1; 

    let bestUpgrade: HacknetUpgrade | null = null;
    let highestROI = -1; // Startet bei -1, damit auch minimale ROIs zählen

    // 1. ROI für einen NEUEN Knoten prüfen (NUR wenn bezahlbar!)
    if (h.numNodes() < 25) {
      const cost = h.getPurchaseNodeCost();
      if (cost <= budget) {
        // Fallback: Wenn Formulas fehlt, nutzen wir einen statischen, fiktiven ROI basierend auf niedrigen Kosten
        const gain = hasFormulas ? ns.formulas.hacknetNodes.moneyGainRate(1, 1, 1, mults) : 1;
        const roi = gain / cost;

        if (roi > highestROI) {
          highestROI = roi;
          bestUpgrade = { type: "Neuer Node", cost: cost };
        }
      }
    }

    // 2. ROI für UPGRADES bestehender Knoten prüfen
    for (let i = 0; i < h.numNodes(); i++) {
      const node: NodeStats = h.getNodeStats(i);

      // Optimierter Helfer: Filtert unbezahlbare Upgrades SOFORT heraus
      const checkROI = (cost: number, newGain: number) => {
        if (cost === Infinity || cost > budget) return false;
        
        // Fallback: Ohne Formulas ist der "ROI" umso höher, je billiger das Upgrade ist
        const roi = hasFormulas ? (newGain - node.production) / cost : 1 / cost;
        
        if (roi > highestROI) {
          highestROI = roi;
          return true;
        }
        return false;
      };

      // Level-Upgrade prüfen
      const lvlCost = h.getLevelUpgradeCost(i, 1);
      const nextLvlGain = hasFormulas ? ns.formulas.hacknetNodes.moneyGainRate(node.level + 1, node.ram, node.cores, mults) : 0;
      if (checkROI(lvlCost, nextLvlGain)) {
        bestUpgrade = { type: "Level", index: i, cost: lvlCost };
      }

      // RAM-Upgrade prüfen
      const ramCost = h.getRamUpgradeCost(i, 1);
      const nextRamGain = hasFormulas ? ns.formulas.hacknetNodes.moneyGainRate(node.level, node.ram * 2, node.cores, mults) : 0;
      if (checkROI(ramCost, nextRamGain)) {
        bestUpgrade = { type: "RAM", index: i, cost: ramCost };
      }

      // Core-Upgrade prüfen
      const coreCost = h.getCoreUpgradeCost(i, 1);
      const nextCoreGain = hasFormulas ? ns.formulas.hacknetNodes.moneyGainRate(node.level, node.ram, node.cores + 1, mults) : 0;
      if (checkROI(coreCost, nextCoreGain)) {
        bestUpgrade = { type: "Core", index: i, cost: coreCost };
      }
    }

    // 3. Bestes BEZAHLBARES Upgrade ausführen
    if (bestUpgrade) {
      const { type, index, cost } = bestUpgrade;

      if (type === "Neuer Node") {
        h.purchaseNode();
      } else if (index !== undefined) {
        if (type === "Level") h.upgradeLevel(index, 1);
        else if (type === "RAM") h.upgradeRam(index, 1);
        else if (type === "Core") h.upgradeCore(index, 1);
      }

      const indexStr = index !== undefined ? ` (Node ${index})` : "";
      const modeStr = hasFormulas ? "ROI-Math" : "Cheap-Fallback";
      ns.print(`[HACKNET] [${modeStr}] Gekauft: ${type}${indexStr} für $${ns.format.number(cost, 2)}`);
      
      // Schneller Takt bei Käufen, um RAM/Level zügig hochzuziehen
      await ns.sleep(50); 
    } else {
      // Wenn wir uns absolut gar nichts leisten können (oder Limit erreicht)
      // Im Early-Game schlafen wir kürzer (10s), um schnell auf Geldzuwachs zu reagieren
      const sleepTime = hasFormulas ? 20000 : 10000;
      ns.print(`[HACKNET] Keine effizienten Upgrades im Budget ($${ns.format.number(budget)}). Standby...`);
      await ns.sleep(sleepTime);
    }
  }
}