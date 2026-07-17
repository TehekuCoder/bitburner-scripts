import { NS } from "@ns";
import { loadState, patchState } from "./state-manager.js";
import { Logger } from "./logger.js";
import { ScriptList } from "./types.js";

export async function main(ns: NS): Promise<void> {
  const logger = new Logger(ns, "Kernel", "INFO");
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

  // --- 🔄 BOOT-SEQUENCE: INITIALIZER ---
  logger.info("Initiiere System-Boot...");
  const initPid = ns.run("core/sys-initializer.js", 1);
  if (initPid === 0) {
    logger.error("Kritischer Boot-Fehler: Initializer konnte nicht gestartet werden!");
    return;
  }
  while (ns.isRunning(initPid)) {
    await ns.sleep(50);
  }

  // --- 📡 INITIAL STATE SETTING ---
  const existingState = (loadState(ns) || {}) as Record<string, any>;
  patchState(ns, {
    strategy: existingState.strategy || "MONEY",
    progressBar: "Kernel operativ. Warte auf Subsysteme.",
    allServers: existingState.allServers || [],
    kernelTarget: existingState.kernelTarget || "n00dles",
  });

  // --- 🖥️ CORE UI BOOT ---
  if (!ns.scriptRunning("core/sys-hud.js", "home")) ns.run("core/sys-hud.js", 1);
  if (ns.fileExists(scripts.dashboard, "home") && !ns.scriptRunning(scripts.dashboard, "home")) {
    ns.run(scripts.dashboard, 1);
  }

  // Pfade für die beiden Flotten-Modi
  const earlyFleetScript = "core/sys-early-fleet.js";

  while (true) {
    const homeMax = ns.getServerMaxRam("home");
    const currentState = loadState(ns);
    const hasNavigator = ns.fileExists("DarkscapeNavigator.exe", "home");

    // --- 🤖 SUBSYSTEM ORCHESTRATION ---

    // 1. Suite-Manager Daemon (Ab 16GB)
    if (homeMax >= 16 && !ns.isRunning("core/sys-suites.js", "home")) {
      if ((homeMax - ns.getServerUsedRam("home")) >= 12.0) {
        ns.run("core/sys-suites.js", 1);
      }
    }

    // 2. Infrastruktur-Manager (Immer aktiv für P-Server/Upgrades)
    if (ns.fileExists(scripts.infra, "home") && !ns.isRunning(scripts.infra, "home")) {
      ns.run(scripts.infra, 1);
    }

    // 3. Darknet- / Crawler-Daemons (Nur wenn Navigator vorhanden)
    if (hasNavigator) {
      if (ns.fileExists(scripts.dnet, "home") && !ns.isRunning(scripts.dnet, "home")) ns.run(scripts.dnet, 1);
      if (ns.fileExists(scripts.crawler, "home") && !ns.isRunning(scripts.crawler, "home")) ns.run(scripts.crawler, 1);
    }

    // --- ⚡ DYNAMISCHER FLOTTEN-MODUS SHIFT ---
    const isDispatcherReady = homeMax >= 64 && ns.fileExists(scripts.dispatcher, "home");

    if (isDispatcherReady) {
      // Modus: Advanced Batching
      if (ns.isRunning(earlyFleetScript, "home")) {
        logger.info("Upgrade auf Advanced Batcher. Stoppe Early-Fleet...");
        ns.scriptKill(earlyFleetScript, "home");
      }
      if (!ns.isRunning(scripts.dispatcher, "home")) {
        logger.success("Starte zentralen System-Dispatcher...");
        ns.run(scripts.dispatcher, 1);
      }
    } else {
      // Modus: Early-Game Basic Hacking / XP Grind
      if (!ns.isRunning(earlyFleetScript, "home") && ns.fileExists(earlyFleetScript, "home")) {
        logger.info("Dispatcher nicht bereit (<64GB). Starte Early-Fleet Manager...");
        ns.run(earlyFleetScript, 1);
      }
    }

    // Passt die globalen Netzwerk-Grunddaten an, ohne tiefe Scans im Kernel zu machen
    patchState(ns, {
      hasDarkScapeNavigator: hasNavigator,
      totalNodes: currentState?.allServers?.length || 0,
    });

    await ns.sleep(5000); // 5 Sekunden Intervall reicht für die reine Prozessüberwachung völlig aus
  }
}