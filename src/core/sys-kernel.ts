import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { PATHS } from "/lib/paths.js";
import { loadState, patchState } from "/lib/state.js";
import { breakAndInfectNetwork, getAllServers } from "/lib/network.js";
import { REFRESH_INTERVALS } from "/lib/constants.js";

// RAM-Puffer-Konfiguration für Home
const HOME_RESERVED_RAM_DEFAULT = 16; // Standard-Puffer (GB) für Backdoor / System-Scripts
const HOME_RESERVED_RAM_LOW = 8;      // Reduzierter Puffer bei <= 32GB Home-RAM

/** Hilfsmethode zur Auflösung von .ts zu .js Dateipfaden für Bitburner Runtime Checks */
const resolvePath = (path: string): string =>
  path.endsWith(".ts") ? path.replace(/\.ts$/, ".js") : path;

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  // ====================================================================
  // 1. CORE SYSTEM INIT (Logger & Performance Monitor)
  // ====================================================================
  if (
    ns.fileExists(PATHS.core.logger, "home") &&
    !ns.isRunning(PATHS.core.logger, "home")
  ) {
    ns.run(PATHS.core.logger, 1);
    await ns.sleep(50);
  }

  if (
    ns.fileExists(PATHS.daemons.perfMonitor, "home") &&
    !ns.isRunning(PATHS.daemons.perfMonitor, "home")
  ) {
    ns.run(PATHS.daemons.perfMonitor, 1);
  }

  const logger = new Logger(ns, "Kernel");
  logger.info("Kernel gestartet. Überprüfe System-State...");

  // ====================================================================
  // 2. STATE INITIALIZER (One-Time Boot Script)
  // ====================================================================
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

  let lastNetworkScan = 0;

  // ====================================================================
  // 3. MAIN KERNEL LOOP (Supervisor & Network & Fallback)
  // ====================================================================
  while (true) {
    const now = Date.now();
    const homeMax = ns.getServerMaxRam("home");
    const homeUsed = ns.getServerUsedRam("home");
    const homeFree = homeMax - homeUsed;
    const currentState = loadState(ns);

    // A. NETWORK BREACH & INFECT
    if (
      now - lastNetworkScan > (REFRESH_INTERVALS?.NETWORK_SCAN ?? 10_000) ||
      !currentState?.allServers?.length
    ) {
      await breakAndInfectNetwork(ns);
      const allServers = getAllServers(ns);
      patchState(ns, { allServers });
      lastNetworkScan = now;
    }

    // B. SYSTEM ORCHESTRATOR (Zentraler Service Manager)
    if (
      homeMax >= 16 &&
      ns.fileExists(PATHS.core.sysOrchestrator, "home") &&
      !ns.isRunning(PATHS.core.sysOrchestrator, "home")
    ) {
      const reqRam = ns.getScriptRam(PATHS.core.sysOrchestrator, "home");
      if (homeFree >= reqRam) {
        logger.info("Starte System Orchestrator...");
        ns.run(PATHS.core.sysOrchestrator, 1);
      }
    }

    // C. FALLBACK WORKER (Netzwerkweite Verteilung & dynamische Home-Steuerung)
    const orchestratorExecPath = resolvePath(PATHS.daemons.hackingOrchestrator);
    const workExecPath = resolvePath(PATHS.payloads.work);
    const isHackingOrchestratorRunning = ns.isRunning(orchestratorExecPath, "home");
    const allServersList = currentState?.allServers?.length ? currentState.allServers : getAllServers(ns);

    if (isHackingOrchestratorRunning) {
      // Beende Fallback-Worker überall, wenn der Batch-Orchestrator übernimmt
      for (const server of allServersList) {
        if (ns.isRunning(workExecPath, server)) {
          ns.scriptKill(workExecPath, server);
        }
      }
    } else if (ns.fileExists(workExecPath, "home")) {
      const target = currentState?.kernelTarget || "n00dles";
      const workerRam = ns.getScriptRam(workExecPath, "home");

      if (workerRam > 0) {
        // 1. VERTEILUNG AUF EXTERNE SERVER (Root-Zugriff & freier RAM)
        for (const server of allServersList) {
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
              ns.exec(workExecPath, server, threads, target);
            }
          }
        }

        // 2. DYNAMISCHE STEUERUNG AUF HOME
        const financeExecPath = resolvePath(PATHS.daemons.financeDispatcher);
        const isFinanceWaiting = homeMax >= 128 &&
          ns.fileExists(financeExecPath, "home") &&
          !ns.isRunning(financeExecPath, "home");

        // Wenn der Finance Dispatcher bereitsteht, aber noch nicht läuft -> Home RAM freigeben
        if (isFinanceWaiting) {
          if (ns.isRunning(workExecPath, "home")) {
            logger.info("Finance Dispatcher wartet auf RAM. Gebe Home-RAM frei...");
            ns.scriptKill(workExecPath, "home");
          }
        } else {
          // Normaler Fallback mit reserviertem Puffer
          const reservedRam = homeMax <= 32 ? HOME_RESERVED_RAM_LOW : HOME_RESERVED_RAM_DEFAULT;
          const usableHomeFree = Math.max(0, homeFree - reservedRam);
          const maxThreads = Math.floor(usableHomeFree / workerRam);
          const isWorkerRunning = ns.isRunning(workExecPath, "home", target);

          if (maxThreads > 0) {
            if (!isWorkerRunning) {
              logger.info(
                `Starte Fallback-Worker auf home (${target}) mit ${maxThreads} Threads (Puffer: ${reservedRam}GB)...`
              );
              ns.run(workExecPath, maxThreads, target);
            }
          } else if (isWorkerRunning) {
            logger.warn(`Zu wenig RAM für Puffer (${reservedRam}GB). Stoppe Fallback-Worker auf home...`);
            ns.scriptKill(workExecPath, "home");
          }
        }
      }
    }

    // D. ENDGAME TRIGGER (WorldDaemon Watchdog)
    const targetNode = "w0r1d_d43m0n";
    if (ns.serverExists(targetNode) && ns.hasRootAccess(targetNode)) {
      const reqSkill = ns.getServerRequiredHackingLevel(targetNode);
      if (
        ns.getHackingLevel() >= reqSkill &&
        !ns.scriptRunning(PATHS.core.apocalypse, "home")
      ) {
        logger.success("💥 WorldDaemon gehackt! Leite Apocalypse ein...");
        ns.run(PATHS.core.apocalypse, 1);
      }
    }

    await ns.sleep(5000);
  }
}