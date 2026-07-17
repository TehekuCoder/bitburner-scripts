import { NS } from "@ns";
// 1. Importiere BotStrategy hier hinzu:
import { loadState, patchState, BotStrategy } from "./state-manager.js"; 
import { getAllServers, breakAndInfectNetwork } from "../lib/network.js";
import { deployWorker } from "../utils/deployment.js";
import { ScriptList } from "./types.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const scripts: ScriptList = {
    worker: "tasks/work.js",
    dispatcher: "core/sys-dispatcher.js",
    infra: "core/sys-infra.js",
    backdoor: "tasks/backdoor.js",
    xpfarm: "tasks/xp-grind.js",
    trade: "systems/finance.js",
    hacknet: "systems/hacknet-early.js",
    dnet: "core/dnet-master.js",
    crawler: "tasks/dnet-crawler.js",
    hack: "tasks/hack.js",
    grow: "tasks/grow.js",
    weaken: "tasks/weaken.js",
    sleeve: "core/sys-sleeve.js",
    dashboard: "core/sys-dashboard.js",
  };

  let lastRootCount = -1;
  let lastStrategy = "";
  let lastProgressBar = "";
  let lastDeployedTarget = "";
  let lastDeployedStrategy = "";
  
  let allNodes: string[] = [];
  let lastNetworkScan = 0;
  const NETWORK_SCAN_INTERVAL = 30000;

  // Multiplikatoren einmalig beim Start laden (schont I/O)
  let bnMults: Record<string, number> = {};
  try {
    const fileContent = ns.read("/bn-multipliers.txt");
    if (fileContent) bnMults = JSON.parse(fileContent);
  } catch (_) {}

  while (true) {
    const now = Date.now();
    const homeMax = ns.getServerMaxRam("home");
    const player = ns.getPlayer();
    const currentState = loadState(ns);

    // --- 📡 1. THROTTLED NETZWERK SCAN & INFEKTION ---
    if (now - lastNetworkScan > NETWORK_SCAN_INTERVAL || allNodes.length === 0) {
      breakAndInfectNetwork(ns);
      allNodes = getAllServers(ns);
      lastNetworkScan = now;
    }

    const currentRootCount = allNodes.filter((n) => ns.hasRootAccess(n)).length;
    const networkChanged = currentRootCount !== lastRootCount;
    lastRootCount = currentRootCount;

    // --- 🧠 2. STRATEGIE-EVALUATION (Aus altem Kernel übernommen) ---
    let activeStrategy: BotStrategy = "MONEY";
    let activeProgressBar = "💻 Early-Fleet aktiv: Optimiere Server-Einkommen.";

    const hackingEfficiency = (bnMults.ServerMaxMoney ?? 1.0) * (bnMults.ScriptHackMoneyGain ?? 1.0);
    const hackingExpMult = bnMults.HackingLevelMultiplier ?? 1.0;

    if (hackingEfficiency === 0) {
      activeStrategy = "XP_SPRINT";
      activeProgressBar = "📉 BN-Sonderregel: Hacking wirft kein Geld ab! Fokus auf XP-Sprint.";
    } else if (hackingEfficiency < 0.2 && player.money < 50_000_000 && (bnMults.CrimeMoney ?? 1.0) > 0.5) {
      activeStrategy = "CRIME";
      activeProgressBar = `🥷 Hacking ineffizient (${(hackingEfficiency * 100).toFixed(0)}%). Starte Verbrechen-Grind.`;
    } else {
      const combatAvg = (player.skills.strength + player.skills.defense + player.skills.dexterity + player.skills.agility) / 4;
      if ((bnMults.CompanyWorkMoney ?? 1.0) > 1.2 && combatAvg >= 30) {
        activeStrategy = "CORP";
        activeProgressBar = `🏢 BN-Spezial: Firmen-Arbeit stark skaliert (${((bnMults.CompanyWorkMoney ?? 1.0) * 100).toFixed(0)}%).`;
      }
    }

    if (activeStrategy === "XP_SPRINT" && hackingExpMult < 0.2) {
      activeProgressBar = `⚠️ XP-Sprint aktiv, aber Hacking-XP stark gedrosselt (${(hackingExpMult * 100).toFixed(0)}%)!`;
    }

    // State updaten, falls sich die Strategie geändert hat
    if (activeStrategy !== lastStrategy || activeProgressBar !== lastProgressBar) {
      patchState(ns, { strategy: activeStrategy, progressBar: activeProgressBar });
      lastStrategy = activeStrategy;
      lastProgressBar = activeProgressBar;
    }

    // --- 🚀 3. FLEET-DEPLOYMENT ---
    const bestTarget = currentState?.kernelTarget || "n00dles";
    const targetChanged = bestTarget !== lastDeployedTarget;
    const strategyChanged = activeStrategy !== lastDeployedStrategy;

    if (targetChanged || strategyChanged || networkChanged) {
      // Wähle das passende Skript basierend auf der Strategie
      let activeScript = activeStrategy === "XP_SPRINT" ? scripts.xpfarm : scripts.worker;

      for (const node of allNodes) {
        if (!ns.hasRootAccess(node)) continue;
        // Verhindere, dass 'home' blockiert wird, wenn der Spieler selbst trainieren/arbeiten soll
        if (node === "home" && ["TRAIN", "CORP", "CRIME"].includes(activeStrategy)) continue;

        // RAM-Buffer für Home berechnen, um System-Daemons nicht zu kicken
        let ramBuffer = 0;
        if (node === "home") {
          const weakenModifier = (bnMults.ServerWeakenRate ?? 1.0) < 1.0 ? Math.ceil(16 / (bnMults.ServerWeakenRate ?? 1.0)) : 0;
          const baseBuffer = ["CRIME", "TRAIN", "CORP", "XP_SPRINT"].includes(activeStrategy) ? 24 : 12;
          ramBuffer = Math.min(baseBuffer + weakenModifier, homeMax * 0.4);
        }

        // Nutzt dein existierendes deployWorker-Utility, um work.js/xp-grind.js auszuführen
        deployWorker(ns, node, activeScript, bestTarget, ramBuffer, scripts);
      }

      lastDeployedTarget = bestTarget;
      lastDeployedStrategy = activeStrategy;
    }

    // Update Netzwerk-Metriken im State für das Dashboard
    patchState(ns, {
      rootCount: currentRootCount,
      allServers: allNodes,
    });

    await ns.sleep(5000); // Alle 5 Sekunden reicht für die Early-Fleet völlig aus
  }
}