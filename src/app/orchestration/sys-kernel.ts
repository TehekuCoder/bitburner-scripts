import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client";
import {
  breakAndInfectNetwork,
  getAllServers,
} from "/infrastructure/network/network";
import { PATHS } from "/infrastructure/runtime/paths";
import { loadState, patchState } from "/infrastructure/state/state";
import {
  REFRESH_INTERVALS,
  HOME_RESERVED_RAM_LOW,
  HOME_RESERVED_RAM_MID,
  HOME_RESERVED_RAM_HIGH,
  HOME_RESERVED_RAM_ULTRA,
} from "/shared/constants/game-defaults";
import { getExactBitNode } from "/lib/utils";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const currentBitnode = getExactBitNode(ns);

  if (
    ns.fileExists(PATHS.infrastructure.logging.logger, "home") &&
    !ns.isRunning(PATHS.infrastructure.logging.logger, "home")
  ) {
    ns.run(PATHS.infrastructure.logging.logger, 1);
    await ns.sleep(50);
  }

  if (
    ns.fileExists(PATHS.services.daemons.perfMonitor, "home") &&
    !ns.isRunning(PATHS.services.daemons.perfMonitor, "home")
  ) {
    ns.run(PATHS.services.daemons.perfMonitor, 1);
  }

  const logger = new LoggerClient(ns, "Kernel");
  logger.info("Kernel gestartet. Überprüfe System-State...");

  if (!loadState(ns) && ns.fileExists(PATHS.app.orchestration.boot, "home")) {
    logger.info("Kein State gefunden. Führe Einmal-Initializer aus...");
    const bootPid = ns.run(PATHS.app.orchestration.boot, 1);
    if (bootPid > 0) {
      while (ns.isRunning(bootPid)) {
        await ns.sleep(50);
      }
    }
  }

  const defaultTarget = resolveFallbackTarget(ns);
  const existingState = (loadState(ns) || {}) as Record<string, any>;
  patchState(ns, {
    currentBitNode: currentBitnode.node,
    currentBitNodeLevel: currentBitnode.level,
    strategy: existingState.strategy || "MONEY",
    progressBar: "Kernel operativ. Warte auf Subsysteme.",
    allServers: existingState.allServers || [],
    kernelTarget: defaultTarget,
  });

  let lastNetworkScan = 0;
  let fallbackActive = false;

  while (true) {
    const now = Date.now();
    const homeMax = ns.getServerMaxRam("home");
    const homeUsed = ns.getServerUsedRam("home");
    const homeFree = homeMax - homeUsed;
    const currentState = loadState(ns);

    if (
      now - lastNetworkScan > (REFRESH_INTERVALS?.NETWORK_SCAN ?? 10_000) ||
      !currentState?.allServers?.length
    ) {
      await breakAndInfectNetwork(ns);
      const allServers = getAllServers(ns);
      patchState(ns, { allServers });
      lastNetworkScan = now;
    }

    if (
      homeMax >= 16 &&
      ns.fileExists(PATHS.app.orchestration.orchestrator, "home") &&
      !ns.isRunning(PATHS.app.orchestration.orchestrator, "home")
    ) {
      const reqRam = ns.getScriptRam(
        PATHS.app.orchestration.orchestrator,
        "home",
      );
      if (homeFree >= reqRam) {
        logger.info("Starte System Orchestrator...");
        ns.run(PATHS.app.orchestration.orchestrator, 1);
      }
    }

    const workExecPath = PATHS.services.payloads.work;

    const isHackingOrchestratorRunning = ns
      .ps("home")
      .some((proc) => proc.filename.includes("hacking-orchestrator"));

    const allServersList = currentState?.allServers?.length
      ? currentState.allServers
      : getAllServers(ns);

    if (isHackingOrchestratorRunning) {
      if (fallbackActive) {
        logger.info(
          "Hacking-Orchestrator aktiv! Übergebe Hacking-Steuerung & beende Kernel-Fallback-Worker...",
        );
        stopFallbackWorkers(ns, allServersList, workExecPath);
        fallbackActive = false;
      }
    } else if (ns.fileExists(workExecPath, "home")) {
      fallbackActive = true;
      runFallbackWorkers(
        ns,
        allServersList,
        workExecPath,
        logger,
        homeMax,
        homeFree,
      );
    }

    const targetNode = "w0r1d_d43m0n";
    if (ns.serverExists(targetNode) && ns.hasRootAccess(targetNode)) {
      const reqSkill = ns.getServerRequiredHackingLevel(targetNode);
      if (
        ns.getHackingLevel() >= reqSkill &&
        !ns.scriptRunning(PATHS.app.orchestration.apocalypse, "home")
      ) {
        logger.success("💥 WorldDaemon gehackt! Leite Apocalypse ein...");
        ns.run(PATHS.app.orchestration.apocalypse, 1);
      }
    }

    await ns.sleep(5000);
  }
}

function stopFallbackWorkers(
  ns: NS,
  servers: string[],
  workExecPath: string,
): void {
  for (const server of servers) {
    if (ns.isRunning(workExecPath, server)) {
      ns.scriptKill(workExecPath, server);
    }
  }
}

function getHomeReservedRam(homeMax: number): number {
  if (homeMax <= 32) return HOME_RESERVED_RAM_LOW;
  if (homeMax <= 128) return HOME_RESERVED_RAM_MID;
  if (homeMax <= 256) return HOME_RESERVED_RAM_HIGH;
  return HOME_RESERVED_RAM_ULTRA;
}

function runFallbackWorkers(
  ns: NS,
  servers: string[],
  workExecPath: string,
  logger: LoggerClient,
  homeMax: number,
  homeFree: number,
): void {
  const target = resolveFallbackTarget(ns);
  const workerRam = ns.getScriptRam(workExecPath, "home");

  if (workerRam <= 0) return;

  for (const server of servers) {
    if (server === "home") continue;
    if (!ns.serverExists(server) || !ns.hasRootAccess(server)) continue;

    const srvMax = ns.getServerMaxRam(server);
    const srvUsed = ns.getServerUsedRam(server);
    const srvFree = srvMax - srvUsed;
    const threads = Math.floor(srvFree / workerRam);

    if (threads > 0) {
      if (!ns.fileExists(workExecPath, server)) {
        ns.scp(workExecPath, server, "home");
      }
      if (!ns.isRunning(workExecPath, server, target)) {
        ns.scriptKill(workExecPath, server);
        ns.exec(workExecPath, server, threads, target);
      }
    }
  }

  const financeExecPath = PATHS.services.daemons.financeDispatcher;
  const isFinanceWaiting =
    homeMax >= 128 &&
    ns.fileExists(financeExecPath, "home") &&
    !ns.isRunning(financeExecPath, "home");

  if (isFinanceWaiting) {
    if (ns.isRunning(workExecPath, "home")) {
      logger.info("Finance Dispatcher wartet auf RAM. Gebe Home-RAM frei...");
      ns.scriptKill(workExecPath, "home");
    }
  } else {
    const reservedRam = getHomeReservedRam(homeMax);
    const usableHomeFree = Math.max(0, homeFree - reservedRam);
    const maxThreads = Math.floor(usableHomeFree / workerRam);
    const isWorkerRunning = ns.isRunning(workExecPath, "home", target);

    if (maxThreads > 0) {
      if (!isWorkerRunning) {
        logger.info(
          `Starte Fallback-Worker auf home (${target}) mit ${maxThreads} Threads (Puffer: ${reservedRam}GB)...`,
        );
        ns.run(workExecPath, maxThreads, target);
      }
    } else if (isWorkerRunning) {
      logger.warn(
        `Zu wenig RAM für Puffer (${reservedRam}GB). Stoppe Fallback-Worker auf home...`,
      );
      ns.scriptKill(workExecPath, "home");
    }
  }
}

function resolveFallbackTarget(ns: NS): string {
  if (ns.serverExists("joesguns") && ns.hasRootAccess("joesguns")) {
    return "joesguns";
  }
  return "n00dles";
}
