import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const h = ns.hacknet;

  const isCappedMode = ns.args.length > 0;
  const maxNodes = (ns.args[0] as number) || 15;
  const maxLevels = (ns.args[1] as number) || Infinity;
  const maxRam = (ns.args[2] as number) || Infinity;
  const maxCores = (ns.args[3] as number) || Infinity;

  ns.print(
    `⚡ Micro-Hacknet Subsystem aktiv (${isCappedMode ? "CAPPED MODE" : "LOW-RAM NO-FORMULAS"})`,
  );

  while (true) {
    const numNodes = h.numNodes();

    // 📊 Validierung pro Node
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
      ns.tprint(
        "🛑 [Hacknet-Early] Netburners-Minimum erreicht. Schalte System ab.",
      );
      return;
    }

    const currentMoney = ns.getServerMoneyAvailable("home");
    let budget =
      currentMoney > 20_000_000 ? currentMoney * 0.1 : currentMoney * 0.35;

    let bestCost = Infinity;
    let purchaseType: "Level" | "RAM" | "Core" | "NewNode" | null = null;
    let targetIndex = -1;

    // 1. Kosten für neuen Knoten prüfen
    if (numNodes < maxNodes) {
      const nodeCost = h.getPurchaseNodeCost();
      if (nodeCost <= budget && nodeCost < bestCost) {
        bestCost = nodeCost;
        purchaseType = "NewNode";
      }
    }

    // 2. Günstigstes Upgrade suchen (Mit striktem, individuellem Cap-Filter)
    for (let i = 0; i < numNodes; i++) {
      const stats = h.getNodeStats(i);

      if (stats.level < maxLevels) {
        const lvlCost = h.getLevelUpgradeCost(i, 1);
        if (lvlCost <= budget && lvlCost < bestCost) {
          bestCost = lvlCost;
          purchaseType = "Level";
          targetIndex = i;
        }
      }
      if (stats.ram < maxRam) {
        const ramCost = h.getRamUpgradeCost(i, 1);
        if (ramCost <= budget && ramCost < bestCost) {
          bestCost = ramCost;
          purchaseType = "RAM";
          targetIndex = i;
        }
      }
      if (stats.cores < maxCores) {
        const coreCost = h.getCoreUpgradeCost(i, 1);
        if (coreCost <= budget && coreCost < bestCost) {
          bestCost = coreCost;
          purchaseType = "Core";
          targetIndex = i;
        }
      }
    }

    // 🚀 3. KAUF AUSFÜHREN
    if (purchaseType !== null) {
      if (purchaseType === "NewNode") {
        h.purchaseNode();
        ns.print(
          `[Hacknet] Neuer Node gekauft für $${ns.format.number(bestCost)}`,
        );
      } else {
        if (purchaseType === "Level") h.upgradeLevel(targetIndex, 1);
        if (purchaseType === "RAM") h.upgradeRam(targetIndex, 1);
        if (purchaseType === "Core") h.upgradeCore(targetIndex, 1);
        ns.print(
          `[Hacknet] Node ${targetIndex}: ${purchaseType}-Upgrade für $${ns.format.number(bestCost)}`,
        );
      }
      await ns.sleep(100);
    } else {
      await ns.sleep(isCappedMode ? 5000 : 15000);
    }
  }
}
