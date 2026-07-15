// src/core/sys-kernel.ts

import { NS } from "@ns";
import { loadState, patchState, saveState } from "./state-manager.js";
import { getAllServers, breakAndInfectNetwork } from "../lib/network.js";
import { Logger } from "./logger.js";
import { deployWorker } from "../utils/deployment.js";
import { ScriptList } from "./types.js";

export async function main(ns: NS): Promise<void> {
  const logger = new Logger(ns, "Kernel", "INFO");

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

  ns.disableLog("ALL");

  // --- 🔄 BOOT-SEQUENCE: ENVIRONMENT INITIALIZATION ---
  logger.info("Starte System-Initializer...");
  const initPid = ns.run("core/sys-initializer.js", 1);

  if (initPid === 0) {
    logger.error(
      "Kritischer Fehler: sys-initializer.js konnte nicht gestartet werden!",
    );
    return;
  }

  while (ns.isRunning(initPid)) {
    await ns.sleep(50);
  }
  logger.success("System-Initialisierung abgeschlossen.");

  // --- 📡 SICHERER STATE-MERGE ---
  logger.info("Verbinde mit globalem State-Port...");
  const existingState = (loadState(ns) || {}) as Record<string, any>;

  patchState(ns, {
    strategy: existingState.strategy || "MONEY",
    progressBar: existingState.progressBar || "Kernel erfolgreich gestartet.",
    batcherProgress: existingState.batcherProgress || "Inaktiv",
    financeProgress: existingState.financeProgress || "Berechne Budget...",
    traderProgress: existingState.traderProgress || "Kein Depot",
    hacknetProgress: existingState.hacknetProgress || "Inaktiv",
    currentBitNode: existingState.currentBitNode || 1,
    currentBitNodeLevel: existingState.currentBitNodeLevel || 1,
    sourceFiles: existingState.sourceFiles || {},
    hasDarkScapeNavigator: existingState.hasDarkScapeNavigator || false,
    hasTorRouter: existingState.hasTorRouter || false,
    hasGang: existingState.hasGang || false,
    hasCorporation: existingState.hasCorporation || false,
    hasBladeburner: existingState.hasBladeburner || false,
    allServers: existingState.allServers || [],
    kernelTarget: existingState.kernelTarget || "n00dles",
  });

  if (!ns.scriptRunning("core/sys-hud.js", "home")) {
    logger.info("Starte HUD-Overlay...");
    ns.run("core/sys-hud.js", 1);
  }

  if (
    ns.fileExists(scripts.dashboard, "home") &&
    !ns.scriptRunning(scripts.dashboard, "home")
  ) {
    logger.success("Starte Consolidated Operational Dashboard...");
    ns.run(scripts.dashboard, 1);
  }

  let lastRootCount = -1;
  let lastStrategy = "";
  let lastProgressBar = "";
  let lastDeployedTarget = "";
  let lastDeployedStrategy = "";
  let lastProbeTime = 0;

  // Throttling für Netzwerk-Scans im Kernel
  let allNodes: string[] = [];
  let lastNetworkScan = 0;
  const NETWORK_SCAN_INTERVAL = 30000;

  while (true) {
    const now = Date.now();

    // --- THROTTLED NETZWERK SCAN ---
    if (
      now - lastNetworkScan > NETWORK_SCAN_INTERVAL ||
      allNodes.length === 0
    ) {
      breakAndInfectNetwork(ns);
      allNodes = getAllServers(ns);
      lastNetworkScan = now;
    }

    const currentRootCount = allNodes.filter((n) => ns.hasRootAccess(n)).length;
    const networkChanged = currentRootCount !== lastRootCount;
    lastRootCount = currentRootCount;

    const homeMax = ns.getServerMaxRam("home");
    const player = ns.getPlayer();
    const currentState = loadState(ns);

    let bnMults: Record<string, number> = {};
    try {
      const fileContent = ns.read("/bn-multipliers.txt");
      if (fileContent) {
        bnMults = JSON.parse(fileContent);
      }
    } catch (_) {}

    // --- 📡 DYNAMISCHE PROGRESSION-PROBES & TARGETING ---
    if (now - lastProbeTime > 15000) {
      const freeRam = homeMax - ns.getServerUsedRam("home");

      if (homeMax >= 8 && !ns.isRunning("utils/probe-sing.js", "home")) {
        if (freeRam >= 3.6) ns.run("utils/probe-sing.js", 1);
      }

      if (homeMax >= 16 && !ns.isRunning("utils/probe-gang.js", "home")) {
        if (freeRam >= 5.6) ns.run("utils/probe-gang.js", 1);
      }

      if (homeMax >= 16 && !ns.isRunning("utils/probe-blade.js", "home")) {
        if (freeRam >= 5.6) ns.run("utils/probe-blade.js", 1);
      }

      if (homeMax >= 128 && !ns.isRunning("utils/probe-corp.js", "home")) {
        if (freeRam >= 81.6) ns.run("utils/probe-corp.js", 1);
      }

      if (!ns.isRunning("utils/probe-target.js", "home")) {
        if (freeRam >= 4.3) {
          ns.run("utils/probe-target.js", 1);
        }
      }

      lastProbeTime = now;
    }

    let activeStrategy = currentState?.strategy || "MONEY";
    let activeProgressBar = currentState?.progressBar || "";

    const isDispatcherReady =
      homeMax >= 256 && ns.fileExists(scripts.dispatcher, "home");

    if (!isDispatcherReady) {
      const hackingEfficiency =
        (bnMults.ServerMaxMoney ?? 1.0) * (bnMults.ScriptHackMoneyGain ?? 1.0);
      const hackingExpMult = bnMults.HackingLevelMultiplier ?? 1.0;

      if (hackingEfficiency === 0) {
        activeStrategy = "XP_SPRINT";
        activeProgressBar =
          "📉 BN-Sonderregel: Hacking wirft kein Geld ab! Fokus auf XP-Sprint.";
      } else if (
        hackingEfficiency < 0.2 &&
        player.money < 50_000_000 &&
        (bnMults.CrimeMoney ?? 1.0) > 0.5
      ) {
        activeStrategy = "CRIME";
        activeProgressBar = `🥷 Hacking ineffizient (${(hackingEfficiency * 100).toFixed(0)}%). Starte Verbrechen-Grind.`;
      } else {
        const combatAvg =
          (player.skills.strength +
            player.skills.defense +
            player.skills.dexterity +
            player.skills.agility) /
          4;

        if ((bnMults.CompanyWorkMoney ?? 1.0) > 1.2 && combatAvg >= 30) {
          activeStrategy = "CORP";
          activeProgressBar = `🏢 BN-Spezial: Firmen-Arbeit stark skaliert (${((bnMults.CompanyWorkMoney ?? 1.0) * 100).toFixed(0)}%).`;
        } else {
          activeStrategy = "MONEY";
          activeProgressBar = `💻 Hacking-Fleet aktiv (Netzwerk-Ressourcen optimal genutzt)`;
        }
      }

      if (activeStrategy === "XP_SPRINT" && hackingExpMult < 0.2) {
        activeProgressBar = `⚠️ XP-Sprint aktiv, aber BN-Hacking-XP ist stark gedrosselt (${(hackingExpMult * 100).toFixed(0)}%)!`;
      }

      if (
        activeStrategy !== lastStrategy ||
        activeProgressBar !== lastProgressBar
      ) {
        patchState(ns, {
          strategy: activeStrategy,
          progressBar: activeProgressBar,
        });
        lastStrategy = activeStrategy;
        lastProgressBar = activeProgressBar;
      }
    } else {
      activeStrategy = currentState?.strategy || "MONEY";
      activeProgressBar = currentState?.progressBar || "";
    }

    const bestTarget = currentState?.kernelTarget || "n00dles";
    const currentTor = ns.scan("home").includes("darkweb");
    const currentGang = currentState?.hasGang || false;
    const currentCorp = currentState?.hasCorporation || false;
    const currentBlade = currentState?.hasBladeburner || false;

    if (homeMax >= 16 && !ns.isRunning("core/sys-suites.js", "home")) {
      const freeRam = homeMax - ns.getServerUsedRam("home");
      if (freeRam >= 12.0) {
        logger.info("Starte Suite-Manager Daemon...");
        ns.run("core/sys-suites.js", 1);
      }
    }

    let isDispatcherRunning = ns.isRunning(scripts.dispatcher, "home");

    if (isDispatcherReady && !isDispatcherRunning) {
      logger.info(
        "Starte zentralen System-Dispatcher (Dispatcher-Modus aktiv)...",
      );
      ns.run(scripts.dispatcher, 1);
      isDispatcherRunning = true;
    }

    if (
      ns.fileExists(scripts.infra, "home") &&
      !ns.isRunning(scripts.infra, "home")
    ) {
      logger.info("Starte Infrastruktur-Manager...");
      ns.run(scripts.infra, 1);
    }

    // 📡 Darknet läuft jetzt parallel im Hintergrund mit
    if (
      ns.fileExists(scripts.dnet, "home") &&
      !ns.isRunning(scripts.dnet, "home")
    ) {
      logger.info("Starte Darknet-Master Daemon...");
      ns.run(scripts.dnet, 1);
    }

    if (
      ns.fileExists(scripts.crawler, "home") &&
      !ns.isRunning(scripts.crawler, "home")
    ) {
      logger.info("Starte Darknet-Crawler..."); // 🟢 Log korrigiert
      ns.run(scripts.crawler, 1);
    }

    // --- 🧹 CLEANUP & WORKER DEPLOYMENT (Nur wenn Dispatcher schläft) ---
    if (!isDispatcherRunning) {
      const targetChanged = bestTarget !== lastDeployedTarget;
      const strategyChanged = activeStrategy !== lastDeployedStrategy;

      if (targetChanged || strategyChanged || networkChanged) {
        let activeScript =
          activeStrategy === "XP_SPRINT" ? scripts.xpfarm : scripts.worker;

        for (const node of allNodes) {
          if (!ns.hasRootAccess(node)) continue;
          if (
            node === "home" &&
            ["TRAIN", "CORP", "CRIME"].includes(activeStrategy) // 🟢 DNET entfernt, home darf arbeiten!
          )
            continue;

          let ramBuffer = 0;
          if (node === "home") {
            const weakenModifier =
              (bnMults.ServerWeakenRate ?? 1.0) < 1.0
                ? Math.ceil(16 / (bnMults.ServerWeakenRate ?? 1.0))
                : 0;
            const baseBuffer = [
              "CRIME",
              "TRAIN",
              "CORP",
              "XP_SPRINT", // 🟢 DNET entfernt
            ].includes(activeStrategy)
              ? 24
              : 8;
            ramBuffer = Math.min(baseBuffer + weakenModifier, homeMax * 0.4);
          }

          deployWorker(ns, node, activeScript, bestTarget, ramBuffer, scripts);
        }

        lastDeployedTarget = bestTarget;
        lastDeployedStrategy = activeStrategy;
      }
    }

    patchState(ns, {
      rootCount: currentRootCount,
      totalNodes: allNodes.length,
      hasTorRouter: currentTor,
      hasGang: currentGang,
      hasCorporation: currentCorp,
      hasBladeburner: currentBlade,
      allServers: allNodes,
    });

    await ns.sleep(2000);
  }
}
