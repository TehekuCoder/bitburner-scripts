import { NS } from "@ns";
import {
  loadState,
  patchState,
  clearState,
  saveState,
} from "./state-manager.js";
import { getAllServers, breakAndInfectNetwork } from "../lib/network.js";
import { Logger } from "./logger.js";
import { deployWorker } from "../utils/deployment.js";

export interface ScriptList {
  worker: string;
  dispatcher: string;
  infra: string;
  backdoor: string;
  xpfarm: string;
  trade: string;
  hacknet: string;
  replicator: string;
  crawler: string;
  hack: string;
  grow: string;
  weaken: string;
  sleeve: string;
  dashboard: string;
}

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
    replicator: "core/dnet-master.js",
    crawler: "tasks/dnet/dnet-crawler.js",
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

  logger.info("Initialisiere globalen State-Port...");
  clearState(ns);
  saveState(ns, {
    strategy: "MONEY",
    progressBar: "Kernel erfolgreich gestartet.",
    batcherProgress: "Inaktiv",
    financeProgress: "Berechne Budget...",
    traderProgress: "Kein Depot",
    hacknetProgress: "Inaktiv",
    currentBitNode: 1,
    currentBitNodeLevel: 1,
    sourceFiles: {},
    hasDarkScapeNavigator: false,
    hasTorRouter: false,
    hasGang: false,
    hasCorporation: false,
    hasBladeburner: false,
    allServers: [],
    kernelTarget: "n00dles",
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

  while (true) {
    const now = Date.now();
    breakAndInfectNetwork(ns);
    const allNodes: string[] = getAllServers(ns);

    const currentRootCount = allNodes.filter((n) => ns.hasRootAccess(n)).length;
    const networkChanged = currentRootCount !== lastRootCount;
    lastRootCount = currentRootCount;

    const homeMax = ns.getServerMaxRam("home");
    const player = ns.getPlayer();
    const currentState = loadState(ns);

    // 🟢 Multiplikatoren gratis direkt aus der Datei lesen (0 GB RAM)
    let bnMults: Record<string, number> = {};
    try {
      const fileContent = ns.read("/bn-multipliers.txt");
      if (fileContent) {
        bnMults = JSON.parse(fileContent);
      }
    } catch (_) {
      // Falls die Datei beim allerersten Boot noch nicht existiert, bleibt bnMults leer ({})
    }

    // --- 📡 DYNAMISCHE PROGRESSION-PROBES & TARGETING ---
    if (now - lastProbeTime > 15000) {
      const freeRam = homeMax - ns.getServerUsedRam("home");

      // 1. Singularity & SourceFiles Probe (~3.6 GB)
      if (homeMax >= 8 && !ns.isRunning("/utils/probe-sing.js", "home")) {
        if (freeRam >= 3.6) ns.run("/utils/probe-sing.js", 1);
      }

      // 2. Gang Probe (~5.6 GB)
      if (homeMax >= 16 && !ns.isRunning("/utils/probe-gang.js", "home")) {
        if (freeRam >= 5.6) ns.run("/utils/probe-gang.js", 1);
      }

      // 3. Bladeburner Probe (~5.6 GB)
      if (homeMax >= 16 && !ns.isRunning("/utils/probe-blade.js", "home")) {
        if (freeRam >= 5.6) ns.run("/utils/probe-blade.js", 1);
      }

      // 4. Corporation Probe (~81.6 GB)
      if (homeMax >= 128 && !ns.isRunning("/utils/probe-corp.js", "home")) {
        if (freeRam >= 81.6) ns.run("/utils/probe-corp.js", 1);
      }

      // 5. Target Finder Probe (~4.30 GB RAM) - Auslagerung von ns.getServer()
      if (!ns.isRunning("/utils/probe-target.js", "home")) {
        if (freeRam >= 4.3) {
          ns.run("/utils/probe-target.js", 1);
        }
      }

      lastProbeTime = now;
    }

    let activeStrategy = currentState?.strategy || "MONEY";
    let activeProgressBar = currentState?.progressBar || "";

    const isDispatcherReady =
      homeMax >= 256 && ns.fileExists(scripts.dispatcher, "home");

    if (!isDispatcherReady) {
      // 🛡️ FALLBACK-LOGIK (Early Game) - Verwendet bnMults aus dem State!
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

    // Hole das beste Ziel sicher aus dem State (geschrieben von probe-target.ts)
    const bestTarget = currentState?.kernelTarget || "n00dles";

    const currentTor = ns.scan("home").includes("darkweb");
    const currentGang = currentState?.hasGang || false;
    const currentCorp = currentState?.hasCorporation || false;
    const currentBlade = currentState?.hasBladeburner || false;

    // --- START SUITE-DAEMON WENN GENUG RAM ---
    if (homeMax >= 16 && !ns.isRunning("/core/sys-suites.js", "home")) {
      const freeRam = homeMax - ns.getServerUsedRam("home");
      if (freeRam >= 12.0) {
        logger.info("Starte Suite-Manager Daemon...");
        ns.run("/core/sys-suites.js", 1);
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

    // --- 🧹 CLEANUP & 📡 WORKER DEPLOYMENT ---
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
            ["REP", "TRAIN", "CORP", "CRIME"].includes(activeStrategy)
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
              "REP",
              "TRAIN",
              "CORP",
              "XP_SPRINT",
            ].includes(activeStrategy)
              ? 24
              : 8;
            ramBuffer = Math.min(baseBuffer + weakenModifier, homeMax * 0.4);
          }

          await deployWorker(
            ns,
            node,
            activeScript,
            bestTarget,
            ramBuffer,
            scripts,
          );
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
      allServers: allNodes, // Füttert probe-target mit der Serverliste!
    });

    await ns.sleep(2000);
  }
}
