import { NS, NodeStats } from "@ns";

interface HacknetUpgrade {
  type: "Level" | "RAM" | "Core" | "Neuer Node";
  cost: number;
  index?: number;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const h = ns.hacknet;

  // --- ARGUMENTEN-LAYER FÜR DYNAMISCHE DECKELUNG ---
  const isCappedMode = ns.args.length > 0;
  const maxNodes = (ns.args[0] as number) || 30; // Fallback auf dein originales Advanced-Cap (30)
  const maxLevels = (ns.args[1] as number) || Infinity;
  const maxRam = (ns.args[2] as number) || Infinity;
  const maxCores = (ns.args[3] as number) || Infinity;

  // --- SAFE ENVIRONMENT LAYER (FAILSAFE-FALLBACK) ---
  let bnMults = { HacknetProduction: 1.0 };

  if (ns.fileExists("bn-multipliers.txt", "home")) {
    try {
      const fileContent = ns.read("bn-multipliers.txt");
      if (fileContent) {
        bnMults = { ...bnMults, ...JSON.parse(fileContent) };
      }
    } catch {
      ns.print(
        "⚠️ [HACKNET] Fehler beim Parsen der bn-multipliers.txt. Failsafe aktiv.",
      );
    }
  }

  if (bnMults.HacknetProduction === 0) {
    ns.print(
      "🛑 [HACKNET] Hacknet-Produktion ist in diesem BitNode deaktiviert. Exit.",
    );
    return;
  }

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
      ns.print(
        "🛑 [Hacknet-Advanced] Netburners-Minimum erreicht. Schalte System ab, um Geld für CORP zu sparen!",
      );
      return;
    }

    const hasFormulas = ns.fileExists("Formulas.exe", "home");
    const hNetMults = ns.getHacknetMultipliers();
    const currentMoney = ns.getServerMoneyAvailable("home");

    // 🧠 1. DYNAMISCHES BUDGET NACH SPIELPHASE
    let baseBudgetPercent = 0.1; // Standard: 10%
    if (currentMoney < 50_000_000) {
      baseBudgetPercent = 0.35; // Early-Game Push: 35%
    } else if (currentMoney > 10_000_000_000) {
      baseBudgetPercent = 0.02; // Late-Game: 2%
    }

    // Skalierung mit der BitNode-Effizienz
    const budget = currentMoney * baseBudgetPercent * bnMults.HacknetProduction;

    let bestUpgrade: HacknetUpgrade | null = null;
    let highestROI = -1;

    // 🏆 2. ROI FÜR EINEN NEUEN KNOTEN (Unter Berücksichtigung des Caps)
    if (numNodes < maxNodes) {
      const baseCost = h.getPurchaseNodeCost();

      if (baseCost <= budget) {
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

    // 3. ROI FÜR UPGRADES BESTEHENDER KNOTEN PRÜFEN
    for (let i = 0; i < numNodes; i++) {
      const node: NodeStats = h.getNodeStats(i);

      const checkROI = (cost: number, newGain: number) => {
        if (cost === Infinity || cost > budget) return false;
        const roi = hasFormulas ? (newGain - node.production) / cost : 1 / cost;

        if (roi > highestROI) {
          highestROI = roi;
          return true;
        }
        return false;
      };

      // Level-Upgrade (nur wenn Gesamt-Level-Cap noch nicht erreicht)
      if (!isCappedMode || totalLevels < maxLevels) {
        const lvlCost = h.getLevelUpgradeCost(i, 1);
        const nextLvlGain = hasFormulas
          ? ns.formulas.hacknetNodes.moneyGainRate(
              node.level + 1,
              node.ram,
              node.cores,
              hNetMults.production,
            )
          : 0;
        if (checkROI(lvlCost, nextLvlGain)) {
          bestUpgrade = { type: "Level", index: i, cost: lvlCost };
        }
      }

      // RAM-Upgrade (nur wenn Gesamt-RAM-Cap noch nicht erreicht)
      if (!isCappedMode || totalRam < maxRam) {
        const ramCost = h.getRamUpgradeCost(i, 1);
        const nextRamGain = hasFormulas
          ? ns.formulas.hacknetNodes.moneyGainRate(
              node.level,
              node.ram * 2,
              node.cores,
              hNetMults.production,
            )
          : 0;
        if (checkROI(ramCost, nextRamGain)) {
          bestUpgrade = { type: "RAM", index: i, cost: ramCost };
        }
      }

      // Core-Upgrade (nur wenn Gesamt-Core-Cap noch nicht erreicht)
      if (!isCappedMode || totalCores < maxCores) {
        const coreCost = h.getCoreUpgradeCost(i, 1);
        const nextCoreGain = hasFormulas
          ? ns.formulas.hacknetNodes.moneyGainRate(
              node.level,
              node.ram,
              node.cores + 1,
              hNetMults.production,
            )
          : 0;
        if (checkROI(coreCost, nextCoreGain)) {
          bestUpgrade = { type: "Core", index: i, cost: coreCost };
        }
      }
    }

    // 4. BESTES UPGRADE AUSFÜHREN
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
      ns.print(
        `[HACKNET] Gekauft: ${type}${indexStr} für $${ns.format.number(cost, 2)}`,
      );

      await ns.sleep(50);
    } else {
      const sleepTime = isCappedMode ? 4000 : hasFormulas ? 15000 : 10000;
      ns.print(
        `[HACKNET] Standby. Budget: $${ns.format.number(budget)} (${(baseBudgetPercent * 100).toFixed(0)}% Allocation)`,
      );
      await ns.sleep(sleepTime);
    }
  }
}
