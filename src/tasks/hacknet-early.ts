import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const h = ns.hacknet;

  ns.print("⚡ Micro-Hacknet Subsystem aktiv (Ultra-Low RAM-Mode)");

  while (true) {
    const currentMoney = ns.getServerMoneyAvailable("home");
    
    // Aggressives Early-Game-Budget: 35% des Geldes investieren
    let budget = currentMoney * 0.35; 
    if (currentMoney > 20_000_000) budget = currentMoney * 0.10; // Später drosseln

    let bestCost = Infinity;
    let purchaseType: "Level" | "RAM" | "Core" | "NewNode" | null = null;
    let targetIndex = -1;

    // 1. Kosten für neuen Knoten prüfen (Cap bei 15 Nodes im ganz frühen Spiel)
    if (h.numNodes() < 15) {
      const nodeCost = h.getPurchaseNodeCost();
      if (nodeCost <= budget && nodeCost < bestCost) {
        bestCost = nodeCost;
        purchaseType = "NewNode";
      }
    }

    // 2. Günstigstes Upgrade auf bestehenden Nodes suchen
    for (let i = 0; i < h.numNodes(); i++) {
      const lvlCost = h.getLevelUpgradeCost(i, 1);
      const ramCost = h.getRamUpgradeCost(i, 1);
      const coreCost = h.getCoreUpgradeCost(i, 1);

      if (lvlCost <= budget && lvlCost < bestCost) {
        bestCost = lvlCost;
        purchaseType = "Level";
        targetIndex = i;
      }
      if (ramCost <= budget && ramCost < bestCost) {
        bestCost = ramCost;
        purchaseType = "RAM";
        targetIndex = i;
      }
      if (coreCost <= budget && coreCost < bestCost) {
        bestCost = coreCost;
        purchaseType = "Core";
        targetIndex = i;
      }
    }

    // 3. Kauf ausführen
    if (purchaseType !== null) {
      if (purchaseType === "NewNode") {
        h.purchaseNode();
        ns.print(`[Hacknet] Neuer Node gekauft für $${ns.format.number(bestCost)}`);
      } else {
        if (purchaseType === "Level") h.upgradeLevel(targetIndex, 1);
        if (purchaseType === "RAM") h.upgradeRam(targetIndex, 1);
        if (purchaseType === "Core") h.upgradeCore(targetIndex, 1);
        ns.print(`[Hacknet] Node ${targetIndex}: ${purchaseType}-Upgrade für $${ns.format.number(bestCost)}`);
      }
      await ns.sleep(100); // Schnelle Kauftaktung bei Erfolg
    } else {
      // Wenn nichts bezahlbar ist, entspannt schlafen (schont die CPU)
      await ns.sleep(15000);
    }
  }
}