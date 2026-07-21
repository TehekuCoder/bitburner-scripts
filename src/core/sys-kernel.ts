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
    trade: "systems/finance.js",
    hacknet: "systems/hacknet-early.js",
    dnet: "core/dnet-master.js",
    crawler: "tasks/dnet-crawler.js",
    hack: "tasks/hack.js",
    grow: "tasks/grow.js",
    weaken: "tasks/weaken.js",
    sleeve: "core/sys-sleeve.js",
    dashboard: "core/sys-dashboard.js",
    fillShare: "core/fill-share.js"
  };

  // --- 🔄 BOOT-SEQUENCE: INITIALIZER ---
  logger.info("Initiiere System-Boot...");
  const initPid = ns.run("core/sys-initializer.js", 1);
  if (initPid === 0) {
    logger.error(
      "Kritischer Boot-Fehler: Initializer konnte nicht gestartet werden!",
    );
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
  if (!ns.scriptRunning("core/sys-hud.js", "home"))
    ns.run("core/sys-hud.js", 1);
  if (
    ns.fileExists(scripts.dashboard, "home") &&
    !ns.scriptRunning(scripts.dashboard, "home")
  ) {
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
      if (homeMax - ns.getServerUsedRam("home") >= 12.0) {
        ns.run("core/sys-suites.js", 1);
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
    // 🧠 Der Dispatcher übernimmt ab 64 GB Home-RAM die Kontrolle.
    // Darunter läuft die eigenständige Early-Fleet.
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
        !ns.scriptRunning("core/sys-apocalypse-ui.js", "home")
      ) {
        logger.success(
          "!!! KRITISCHER SCHWELLENWERT ERREICHT: W0R1D_D43M0N BEREIT !!!",
        );
        ns.run("core/sys-apocalypse-ui.js", 1);
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