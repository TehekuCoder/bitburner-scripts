import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { PATHS } from "/lib/paths";

import { loadState, patchState } from "/lib/state.js";
import { ScriptList } from "/lib/types.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const scripts: ScriptList = {
    logger: PATHS.core.logger,
    perfMonitor: PATHS.daemons.perfMonitor,
    worker: PATHS.payloads.work,
    dispatcher: PATHS.core.dispatcher,
    infra: PATHS.managers.infra,
    backdoor: PATHS.daemons.backdoor,
    trade: PATHS.managers.finance,
    hacknet: PATHS.daemons.hacknetEarly,
    dnet: PATHS.managers.dnet,
    crawler: PATHS.daemons.crawler,
    hack: PATHS.payloads.hack,
    grow: PATHS.payloads.grow,
    weaken: PATHS.payloads.weaken,
    sleeve: PATHS.managers.sleeve,
    fillShare: PATHS.daemons.fillShare,
    augShopping: PATHS.tasks.augShopping,
    augAnalyze: PATHS.tasks.analyzeAug,
    orchestrator: PATHS.core.orchestrator,
    suites: PATHS.core.suites,
  };

  // 1. Logger-Daemon starten
  if (
    ns.fileExists(scripts.logger, "home") &&
    !ns.isRunning(scripts.logger, "home")
  ) {
    ns.run(scripts.logger, 1);
    await ns.sleep(50);
  }

  // 2. Perf-Monitor starten (sobald der Logger bereit ist)
  if (
    ns.fileExists(scripts.perfMonitor, "home") &&
    !ns.isRunning(scripts.perfMonitor, "home")
  ) {
    ns.run(scripts.perfMonitor, 1);
  }

  const logger = new Logger(ns, "Kernel");

  logger.info("Kernel gestartet. Überprüfe System-State...");

  if (!loadState(ns) && ns.fileExists(PATHS.core.boot, "home")) {
    logger.info("Kein State gefunden. Führe Einmal-Initializer aus...");
    const bootPid = ns.run(PATHS.core.boot, 1);
    if (bootPid > 0) {
      while (ns.isRunning(bootPid)) {
        await ns.sleep(50);
      }
    }
  }

  // --- 📡 INITIAL STATE SETTING ---
  const existingState = (loadState(ns) || {}) as Record<string, any>;
  patchState(ns, {
    strategy: existingState.strategy || "MONEY",
    progressBar: "Kernel operativ. Warte auf Subsysteme.",
    allServers: existingState.allServers || [],
    kernelTarget: existingState.kernelTarget || "n00dles",
  });

  // Pfade für die beiden Flotten-Modi
  const earlyFleetScript = PATHS.daemons.earlyFleet;

  while (true) {
    const homeMax = ns.getServerMaxRam("home");
    const currentState = loadState(ns);
    const hasNavigator = ns.fileExists("DarkscapeNavigator.exe", "home");

    // --- 🤖 SUBSYSTEM ORCHESTRATION ---

    // 1. Suite-Manager Daemon (Ab 16GB)
    if (homeMax >= 16 && !ns.isRunning(PATHS.core.suites, "home")) {
      if (homeMax - ns.getServerUsedRam("home") >= 12.0) {
        ns.run(PATHS.core.suites, 1);
      }
    }

    // 2. Infrastruktur-Manager (Immer aktiv für P-Server/Upgrades)
    if (
      ns.fileExists(scripts.infra, "home") &&
      !ns.isRunning(scripts.infra, "home")
    ) {
      ns.run(scripts.infra, 1);
    }

    // 3. Darknet- / Crawler-Daemons (Nur wenn Navigator vorhanden)
    if (hasNavigator) {
      if (
        ns.fileExists(scripts.dnet, "home") &&
        !ns.isRunning(scripts.dnet, "home")
      )
        ns.run(scripts.dnet, 1);
      if (
        ns.fileExists(scripts.crawler, "home") &&
        !ns.isRunning(scripts.crawler, "home")
      )
        ns.run(scripts.crawler, 1);
    }

    // 4. 🟢 Automatischer Backdoor-Manager
    if (
      ns.fileExists(scripts.backdoor, "home") &&
      !ns.isRunning(scripts.backdoor, "home")
    ) {
      logger.info("Starte Backdoor-Manager für Netzwerk-Penetration...");
      ns.run(scripts.backdoor, 1);
    }

    // --- ⚡ DYNAMISCHER FLOTTEN-MODUS SHIFT ---
    const isDispatcherReady =
      homeMax >= 64 && ns.fileExists(scripts.dispatcher, "home");

    if (isDispatcherReady) {
      // Modus: Dispatcher-Kontrolle
      if (ns.isRunning(earlyFleetScript, "home")) {
        logger.warn(
          "64 GB+ RAM erreicht! Übergebe Kontrolle an das Hauptgehirn. Stoppe Early-Fleet...",
        );
        ns.scriptKill(earlyFleetScript, "home");
      }
      if (!ns.isRunning(scripts.dispatcher, "home")) {
        logger.success("Starte zentralen System-Dispatcher...");
        ns.run(scripts.dispatcher, 1);
      }
    } else {
      // Modus: Ultra-Early Game / Boot-Phase (RAM < 64GB)
      if (
        !ns.isRunning(earlyFleetScript, "home") &&
        ns.fileExists(earlyFleetScript, "home")
      ) {
        logger.info(
          "Zentraler Dispatcher benötigt mindestens 64GB RAM. Aktiviere temporäre Early-Fleet...",
        );
        ns.run(earlyFleetScript, 1);
      }
    }

    // 5. 💥 Automatischer End-Game Trigger (Wenn w0r1d_d43m0n bereit ist)
    const targetNode = "w0r1d_d43m0n";
    if (ns.serverExists(targetNode) && ns.hasRootAccess(targetNode)) {
      const reqSkill = ns.getServerRequiredHackingLevel(targetNode);
      if (
        ns.getHackingLevel() >= reqSkill &&
        !ns.scriptRunning(PATHS.core.apocalypse, "home")
      ) {
        logger.success(
          "!!! KRITISCHER SCHWELLENWERT ERREICHT: W0R1D_D43M0N BEREIT !!!",
        );
        ns.run(PATHS.core.apocalypse, 1);
      }
    }

    // Passt die globalen Netzwerk-Grunddaten an
    patchState(ns, {
      hasDarkScapeNavigator: hasNavigator,
      totalNodes: currentState?.allServers?.length || 0,
    });

    await ns.sleep(5000);
  }
}
