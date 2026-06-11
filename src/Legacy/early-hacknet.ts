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
  
  ns.print("🌱 Hacknet-Manager (Formulas-free Edition) gestartet...");

  while (true) {
    const mults = ns.getHacknetMultipliers().production;
    const currentMoney = ns.getServerMoneyAvailable("home");
    
    // --- RISIKOMINIMIERUNG ---
    // Wir halten 200k für Notfälle/Flüge/Fraktionen absolut unangetastet
    const reserveMoney = 200_000;
    const usableMoney = currentMoney - reserveMoney;

    if (usableMoney <= 0) {
      ns.print("⚠️ Hacknet: Geld unter der Sicherheitsreserve (200k). Standby...");
      await ns.sleep(30000);
      continue;
    }

    // Nutzt maximal 10% des VERFÜGBAREN Barbestands über der Reserve
    const budget = usableMoney * 0.1; 

    let bestUpgrade: HacknetUpgrade | null = null;
    let highestROI = 0;

    // 1. ROI für einen NEUEN Knoten prüfen (Cap bei 25 Nodes für das Early Game)
    if (h.numNodes() < 25) {
      const cost = h.getPurchaseNodeCost();
      // Ein neu gekaufter Node (Lvl 1, 1GB RAM, 1 Core) produziert standardmäßig genau 1.5 $ * Multiplikatoren
      const addedGain = 1.5 * mults; 
      const roi = addedGain / cost;
      
      if (roi > highestROI) {
        highestROI = roi;
        bestUpgrade = { type: "Neuer Node", cost: cost };
      }
    }

    // 2. ROI für UPGRADES bestehender Knoten mittels relativer Mathematik prüfen
    for (let i = 0; i < h.numNodes(); i++) {
      const node: NodeStats = h.getNodeStats(i);

      // Helfer für ROI-Vergleich basierend auf dem echten mathematischen Zuwachs
      const checkROI = (cost: number, addedGain: number) => {
        if (cost === Infinity || isNaN(cost) || cost <= 0) return false;
        const roi = addedGain / cost;
        if (roi > highestROI) {
          highestROI = roi;
          return true;
        }
        return false;
      };

      // LEVEL Upgrade: Der Zuwachs entspricht exakt (Aktuelle Produktion / Aktuelles Level)
      const lvlCost = h.getLevelUpgradeCost(i, 1);
      const lvlAddedGain = node.production / node.level;
      if (checkROI(lvlCost, lvlAddedGain)) {
        bestUpgrade = { type: "Level", index: i, cost: lvlCost };
      }

      // RAM Upgrade: Jede Verdopplung bringt mathematisch exakt 3.5% mehr relative Produktion
      const ramCost = h.getRamUpgradeCost(i, 1);
      const ramAddedGain = node.production * 0.035;
      if (checkROI(ramCost, ramAddedGain)) {
        bestUpgrade = { type: "RAM", index: i, cost: ramCost };
      }

      // CORE Upgrade: Der Zuwachsfaktor im Code entspricht exakt 1 / (Aktuelle Cores + 5)
      const coreCost = h.getCoreUpgradeCost(i, 1);
      const coreAddedGain = node.production / (node.cores + 5);
      if (checkROI(coreCost, coreAddedGain)) {
        bestUpgrade = { type: "Core", index: i, cost: coreCost };
      }
    }

    // 3. Bestes Upgrade ausführen (sofern es im 10%-Budget liegt)
    if (bestUpgrade && bestUpgrade.cost <= budget) {
      const { type, index, cost } = bestUpgrade;

      if (type === "Neuer Node") {
        h.purchaseNode();
      } else if (index !== undefined) {
        if (type === "Level") h.upgradeLevel(index, 1);
        else if (type === "RAM") h.upgradeRam(index, 1);
        else if (type === "Core") h.upgradeCore(index, 1);
      }

      const indexStr = index !== undefined ? ` (Node ${index})` : "";
      ns.print(`🛒 Gekauft: ${type}${indexStr} für $${ns.format.number(cost, 2)}`);
      
      // Kurze Pause nach Kauf für Stabilität
      await ns.sleep(100);
    } else {
      // Im Early-Game schlafen wir bei Inaktivität nur 10 statt 30 Sekunden,
      // um schneller auf Geldzuwächse reagieren zu können.
      ns.print("Hacknet: Keine effizienten Upgrades im Budget. Standby...");
      await ns.sleep(10000);
    }
  }
}