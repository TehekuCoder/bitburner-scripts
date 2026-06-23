import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const h = ns.hacknet;

  // --- ARGUMENTEN-LAYER FÜR DYNAMISCHE DECKELUNG ---
  const isCappedMode = ns.args.length > 0;
  const maxNodes = (ns.args[0] as number) || 15; // Fallback auf dein originales Early-Cap (15)
  const maxLevels = (ns.args[1] as number) || Infinity;
  const maxRam = (ns.args[2] as number) || Infinity;
  const maxCores = (ns.args[3] as number) || Infinity;

  ns.print(
    `⚡ Micro-Hacknet Subsystem aktiv (${isCappedMode ? "CAPPED MODE" : "ULTRA-LOW RAM-MODE"})`,
  );

  while (true) {
    const numNodes = h.numNodes();

    // 📊 Berechne aktuelle Gesamtwerte für den Cap-Check
    let totalLevels = 0;
    let totalRam = 0;
    let totalCores = 0;

    for (let i = 0; i < numNodes; i++) {
      const stats = h.getNodeStats(i);
      totalLevels += stats.level;
      totalRam += stats.ram;
      totalCores += stats.cores;
    }

    // 🛑 ABBRUCHBEDINGUNG: Wenn alle Netburners-Ziele erreicht sind
    if (
      isCappedMode &&
      totalLevels >= maxLevels &&
      totalRam >= maxRam &&
      totalCores >= maxCores
    ) {
      ns.tprint(
        "🛑 [Hacknet-Early] Netburners-Minimum erreicht. Schalte System ab, um Geld für CORP zu sparen!",
      );
      return; // Beendet das Skript sauber
    }

    const currentMoney = ns.getServerMoneyAvailable("home");

    // Aggressives Early-Game-Budget: 35% des Geldes investieren
    let budget = currentMoney * 0.35;
    if (currentMoney > 20_000_000) budget = currentMoney * 0.1; // Später drosseln

    let bestCost = Infinity;
    let purchaseType: "Level" | "RAM" | "Core" | "NewNode" | null = null;
    let targetIndex = -1;

    // 1. Kosten für neuen Knoten prüfen (Berücksichtigt dynamisches Cap)
    if (numNodes < maxNodes) {
      const nodeCost = h.getPurchaseNodeCost();
      if (nodeCost <= budget && nodeCost < bestCost) {
        bestCost = nodeCost;
        purchaseType = "NewNode";
      }
    }

    // 2. Günstigstes Upgrade auf bestehenden Nodes suchen (nur wenn das jeweilige Cap noch nicht voll ist)
    for (let i = 0; i < numNodes; i++) {
      const lvlCost = h.getLevelUpgradeCost(i, 1);
      const ramCost = h.getRamUpgradeCost(i, 1);
      const coreCost = h.getCoreUpgradeCost(i, 1);

      if (
        (!isCappedMode || totalLevels < maxLevels) &&
        lvlCost <= budget &&
        lvlCost < bestCost
      ) {
        bestCost = lvlCost;
        purchaseType = "Level";
        targetIndex = i;
      }
      if (
        (!isCappedMode || totalRam < maxRam) &&
        ramCost <= budget &&
        ramCost < bestCost
      ) {
        bestCost = ramCost;
        purchaseType = "RAM";
        targetIndex = i;
      }
      if (
        (!isCappedMode || totalCores < maxCores) &&
        coreCost <= budget &&
        coreCost < bestCost
      ) {
        bestCost = coreCost;
        purchaseType = "Core";
        targetIndex = i;
      }
    }

    // 3. Kauf ausführen
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
      await ns.sleep(100); // Schnelle Kauftaktung bei Erfolg
    } else {
      // Wenn nichts bezahlbar ist oder wir auf ein bestimmtes Cap warten, entspannt schlafen
      const sleepTime = isCappedMode ? 5000 : 15000;
      await ns.sleep(sleepTime);
    }
  }
}
