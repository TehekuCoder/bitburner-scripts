import { NS } from "@ns";
import { loadState } from "./state-manager.js";
import { loadBnMults } from "../lib/state.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.ui.resizeTail(640, 420);

  const bnMults = loadBnMults(ns);

  while (true) {
    const state = loadState(ns);
    ns.clearLog();

    if (!state) {
      ns.print("⏳ Warte auf Initialisierung des System-States...");
      await ns.sleep(1000);
      continue;
    }

    const sources = state.sources || {};
    
    // Hilfsfunktion für einheitliche UI-Zeilen mit Quellenangabe
    const printRow = (label: string, val: string | number | boolean, stateKey?: string) => {
      const source = stateKey ? `[${sources[stateKey] || "Init"}]` : "";
      const paddedLabel = label.padEnd(14);
      const paddedVal = String(val).padEnd(24);
      ns.print(` ${paddedLabel} : ${paddedVal} \x1b[38;5;244m${source}\x1b[0m`);
    };

    ns.print(`==================================================================`);
    ns.print(`👑 \x1b[1;32mBIT-OS CONSOLIDATED OPERATIONAL DASHBOARD\x1b[0m`);
    ns.print(`==================================================================`);
    
    // 1. System & Netzwerk Status
    const rootCount = state.rootCount ?? 0;
    const totalNodes = state.totalNodes ?? 0;
    printRow("NETWORK UNITS", `${rootCount}/${totalNodes}`, "rootCount");
    printRow("ENGINE MODE", (state.isFleetMode ? "DYNAMIC FLEET" : "BASIC LOOP"), "isFleetMode");
    printRow("STRATEGIE", state.strategy, "strategy");

    ns.print(`------------------------------------------------------------------`);
    
    // 2. Targets & Progression
    if (state.isFleetMode) {
      printRow("BATCH TARGET", state.batcherTarget || "Warte auf Dispatcher...", "batcherTarget");
      printRow("FLEET TARGET", state.kernelTarget || "Keines", "kernelTarget");
    } else {
      printRow("BASIC TARGET", state.kernelTarget || "Keines", "kernelTarget");
    }
    
    printRow("FRAKTION", state.targetFaction || "KEINE", "targetFaction");
    printRow("COMPANY", state.targetCompany || "KEINE", "targetCompany");

    ns.print(`------------------------------------------------------------------`);

    // 3. BitNode Multiplikatoren (Statische Configs)
    const hackYield = (bnMults.ServerMaxMoney * bnMults.ScriptHackMoneyGain * 100).toFixed(0);
    const weakenRate = (bnMults.ServerWeakenRate * 100).toFixed(0);
    printRow("HACK-YIELD", `${hackYield}% Effizienz`);
    printRow("WEAKEN-RATE", `${weakenRate}% Tempo`);

    ns.print(`------------------------------------------------------------------`);
    
    // 4. Status Bar & Updates
    const ageSeconds = ((Date.now() - state.lastUpdate) / 1000).toFixed(1);
    printRow("PROGRESS", state.progressBar, "progressBar");
    printRow("LAST UPDATE", `${ageSeconds}s ago`, "lastUpdate");
    
    ns.print(`==================================================================`);

    await ns.sleep(1000); // 1 Sekunde reicht für die Anzeige dicke aus (spart RAM & CPU)
  }
}