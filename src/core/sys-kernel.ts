import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { PATHS } from "/lib/paths";

import { loadFinanceState, loadState, patchState } from "/lib/state.js";
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
    gang: PATHS.daemons.gang,
  };

  if (
    ns.fileExists(scripts.logger, "home") &&
    !ns.isRunning(scripts.logger, "home")
  ) {
    ns.run(scripts.logger, 1);
    await ns.sleep(50);
  }

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

  const existingState = (loadState(ns) || {}) as Record<string, any>;
  patchState(ns, {
    strategy: existingState.strategy || "MONEY",
    progressBar: "Kernel operativ. Warte auf Subsysteme.",
    allServers: existingState.allServers || [],
    kernelTarget: existingState.kernelTarget || "n00dles",
  });

  while (true) {
    const homeMax = ns.getServerMaxRam("home");
    const homeUsed = ns.getServerUsedRam("home");
    const homeFree = homeMax - homeUsed;
    const currentState = loadState(ns);
    const financeState = loadFinanceState(ns);
    const hasNavigator = ns.fileExists("DarkscapeNavigator.exe", "home");
    const hasSingularity = ns.singularity !== undefined;

    const isHomeUnderpowered = homeMax < 256;
    const isSingularityPending =
      isHomeUnderpowered || (financeState?.moneyReserve ?? 0) > 0;

    const canRun = (scriptPath: string, minFreeRamRequirement = 0): boolean => {
      if (!ns.fileExists(scriptPath, "home")) return false;
      if (ns.isRunning(scriptPath, "home")) return false;

      const reqRam = ns.getScriptRam(scriptPath, "home");
      const singBuffer = isSingularityPending ? 20 : 0;
      const effectiveFree = homeFree - singBuffer;

      return effectiveFree >= reqRam && homeFree >= minFreeRamRequirement;
    };

    // 1. HACKING ORCHESTRATOR (Läuft IMMER)
    if (canRun(scripts.orchestrator)) {
      logger.success("🚀 Starte Hacking-Orchestrator...");
      ns.run(scripts.orchestrator, 1);
    }

    // 2. Suite-Manager Daemon (Ab 16GB)
    if (homeMax >= 16 && canRun(PATHS.core.suites, 12.0)) {
      ns.run(PATHS.core.suites, 1);
    }

    // 3. Infrastruktur-Manager (Ab 64GB)
    if (
      homeMax >= 64 &&
      ns.fileExists(scripts.infra, "home") &&
      !ns.isRunning(scripts.infra, "home")
    ) {
      if (homeFree >= ns.getScriptRam(scripts.infra, "home")) {
        ns.run(scripts.infra, 1);
      }
    }

    // 4. Darknet- & Crawler-Daemons (Erst ab 256 GB RAM!)
    if (homeMax >= 256 && hasNavigator) {
      if (canRun(scripts.dnet)) ns.run(scripts.dnet, 1);
      if (canRun(scripts.crawler)) ns.run(scripts.crawler, 1);
    }

    // 5. Automatischer Backdoor-Manager
    if (canRun(scripts.backdoor)) {
      ns.run(scripts.backdoor, 1);
    }

    // 6. DISPATCHER MODUS (Erst ab 256 GB RAM UND SF4 Singularity API)
    const isDispatcherReady =
      homeMax >= 256 &&
      hasSingularity &&
      ns.fileExists(scripts.dispatcher, "home");

    if (isDispatcherReady && canRun(scripts.dispatcher)) {
      logger.success("Starte zentralen System-Dispatcher (SF4)...");
      ns.run(scripts.dispatcher, 1);
    }

    // 7. Gang-Daemon Management
    let isInGang = false;
    try {
      isInGang = ns.gang.inGang();
    } catch (_) {}

    if (isInGang && canRun(scripts.gang)) {
      ns.run(scripts.gang, 1);
    }

    // 8. End-Game Trigger
    const targetNode = "w0r1d_d43m0n";
    if (ns.serverExists(targetNode) && ns.hasRootAccess(targetNode)) {
      const reqSkill = ns.getServerRequiredHackingLevel(targetNode);
      if (
        ns.getHackingLevel() >= reqSkill &&
        !ns.scriptRunning(PATHS.core.apocalypse, "home")
      ) {
        ns.run(PATHS.core.apocalypse, 1);
      }
    }

    patchState(ns, {
      hasDarkScapeNavigator: hasNavigator,
      totalNodes: currentState?.allServers?.length || 0,
    });

    await ns.sleep(5000);
  }
}
