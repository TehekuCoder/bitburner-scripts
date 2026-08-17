import { NS } from "@ns";

import { BatchStrategy } from "/shared/types/batcher.js";
import { PATHS } from "../../infrastructure/runtime/paths.js";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { evaluateHackingStrategy } from "/domain/evaluators/strategy/hacking-strategy.js";
import { evaluateTargets } from "/domain/evaluators/strategy/target-selection.js";
import { patchBatcherState } from "/infrastructure/state/state.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const logger = new LoggerClient(ns, "HACKING-ORCHESTRATOR");
  logger.info("🚀 Hacking Orchestrator erfolgreich gestartet");

  let lastStrategy: BatchStrategy | null = null;
  let lastTarget: string | null = null;

  while (true) {
    const evalRec = evaluateHackingStrategy(ns);

    // 1️⃣ Dynamische Strategie-Ermittlung
    let activeStrategy: BatchStrategy = evalRec.strategy;

    // 2️⃣ Target-Ermittlung
    let activeTarget = evalRec.preferredTarget ?? resolveXpTarget(ns);

    if (activeStrategy === "XP_GRIND") {
      const daemon = "w0r1d_d43m0n";
      const hasDaemonRoot = ns.serverExists(daemon) && ns.hasRootAccess(daemon);
      const reqSkill = hasDaemonRoot
        ? (ns.getServer(daemon).requiredHackingSkill ?? 9999)
        : 9999;
      const playerSkill = ns.getHackingLevel();

      if (hasDaemonRoot && playerSkill >= reqSkill) {
        activeTarget = daemon;
      } else if (!evalRec.preferredTarget) {
        activeTarget = resolveXpTarget(ns);
      }
    }

    // 🛡️ Absicherung bei fehlendem Root
    if (!ns.hasRootAccess(activeTarget)) {
      const fallbackTarget = resolveXpTarget(ns);
      logger.warn(
        `Target '${activeTarget}' hat keinen Root-Zugriff. Fallback auf '${fallbackTarget}'`,
        activeTarget,
      );
      activeTarget = fallbackTarget;
    }

    // 3️⃣ PREP-Check: Server muss erst vorbereitet werden, bevor HWGW/PROTO laufen kann
    if (
      ns.hasRootAccess(activeTarget) &&
      activeStrategy !== "XP_GRIND" &&
      activeStrategy !== "WORKER" &&
      activeStrategy !== "BOOTSTRAP"
    ) {
      const server = ns.getServer(activeTarget);
      const isMaxMoney =
        (server.moneyAvailable ?? 0) >= (server.moneyMax ?? 1) * 0.99;
      const isMinSec =
        (server.hackDifficulty ?? 99) <= (server.minDifficulty ?? 1) + 0.01;

      if (!isMaxMoney || !isMinSec) {
        activeStrategy = "PREP";
      }
    }

    // 📊 Statusänderungen protokollieren
    if (activeStrategy !== lastStrategy || activeTarget !== lastTarget) {
      logger.info(
        `Strategie-Wechsel: ${activeStrategy} | Target: ${activeTarget}`,
        activeTarget,
        { context: { strategy: activeStrategy, target: activeTarget } },
      );
      lastStrategy = activeStrategy;
      lastTarget = activeTarget;
    }

    // 4️⃣ State aktualisieren
    patchBatcherState(ns, {
      batchStrategy: activeStrategy,
      batcherTarget: activeTarget,
      batcherActive: true,
      batcherProgress:
        activeStrategy === "XP_GRIND"
          ? `XP-Grind aktiv auf ${activeTarget}`
          : `Laufende Strategie: ${activeStrategy}`,
    });

    // 5️⃣ Engine starten ODER Multi-Target Worker im Netzwerk verteilen
    if (ns.hasRootAccess(activeTarget)) {
      if (activeStrategy === "BOOTSTRAP" || activeStrategy === "WORKER") {
        // Stoppe evtl. laufende Batcher-Engines auf home
        stopAllEngines(ns, logger);

        // Top-Ziele ermitteln für Multi-Target-Verteilung
        const evalTargets = evaluateTargets(ns, activeStrategy);
        const topTargets =
          evalTargets.length > 0
            ? evalTargets.slice(0, 5).map((t) => t.hostname)
            : [activeTarget];

        // Verteile work.ts netzwerkweit auf mehrere Ziele
        deployWorkerFleet(ns, topTargets, logger);
      } else {
        // Stoppe alte Netz-Worker, falls wir auf Batcher/Prep wechseln
        stopNetworkWorkers(ns);
        ensureEngineRunning(ns, activeStrategy, activeTarget, logger);
      }
    } else {
      logger.error(
        `Kein Root-Zugriff auf ${activeTarget} vorhanden! Engine gestoppt.`,
        activeTarget,
      );
    }

    await ns.sleep(5000);
  }
}

/**
 * Verteilt work.ts auf ALLE gerooteten Server im Netzwerk verteilt über mehrere Ziele.
 */
function deployWorkerFleet(
  ns: NS,
  targets: string[],
  logger: LoggerClient,
): void {
  const workScript = PATHS.services.payloads.work;
  if (!ns.fileExists(workScript, "home")) {
    logger.error(`Worker-Skript '${workScript}' auf home nicht gefunden!`);
    return;
  }

  const scriptRam = ns.getScriptRam(workScript, "home");
  if (scriptRam <= 0) return;

  const servers = getAllRootedServersIncludingPurchased(ns);

  for (let i = 0; i < servers.length; i++) {
    const server = servers[i];
    const maxRam = ns.getServerMaxRam(server);
    if (maxRam <= 0) continue;

    let availableRam = maxRam;

    if (server === "home") {
      // 1. Basispuffer basierend auf der Gesamtgröße von 'home'
      let reservedHomeRam = 32;
      if (maxRam >= 512) {
        reservedHomeRam = 128;
      } else if (maxRam >= 256) {
        reservedHomeRam = 64;
      }

      // 2. Dynamischer Zusatzpuffer für Gang-Dienste (Manager ~14GB + UI ~16GB)
      try {
        if (ns.gang.inGang()) {
          reservedHomeRam += 32;
        }
      } catch {
        // Gang-API noch nicht freigeschaltet/verfügbar
      }

      const usedRamExcludingWork =
        ns.getServerUsedRam("home") - getScriptUsedRam(ns, "home", workScript);
      availableRam = Math.max(
        0,
        maxRam - usedRamExcludingWork - reservedHomeRam,
      );
    } else {
      const usedRamExcludingWork =
        ns.getServerUsedRam(server) - getScriptUsedRam(ns, server, workScript);
      availableRam = maxRam - usedRamExcludingWork;
    }

    const targetThreads = Math.floor(availableRam / scriptRam);
    // Round-Robin Zuordnung der Top-Ziele über das Server-Array
    const assignedTarget = targets[i % targets.length];

    if (targetThreads > 0) {
      if (server !== "home" && !ns.fileExists(workScript, server)) {
        ns.scp(workScript, server, "home");
      }
      manageWorkerOnServer(
        ns,
        server,
        workScript,
        assignedTarget,
        targetThreads,
      );
    } else {
      if (ns.isRunning(workScript, server)) {
        ns.scriptKill(workScript, server);
      }
    }
  }
}

function manageWorkerOnServer(
  ns: NS,
  server: string,
  script: string,
  target: string,
  desiredThreads: number,
): void {
  const procs = ns.ps(server).filter((p) => p.filename === script);
  const isCorrect =
    procs.length === 1 &&
    procs[0].args[0] === target &&
    procs[0].threads === desiredThreads;

  if (isCorrect) return;

  if (procs.length > 0) {
    ns.scriptKill(script, server);
  }

  if (desiredThreads > 0) {
    ns.exec(script, server, desiredThreads, target);
  }
}

function getScriptUsedRam(ns: NS, server: string, script: string): number {
  return ns
    .ps(server)
    .filter((p) => p.filename === script)
    .reduce((acc, p) => acc + p.threads * ns.getScriptRam(script, server), 0);
}

function stopNetworkWorkers(ns: NS): void {
  const workScript = PATHS.services.payloads.work;
  const servers = getAllRootedServersIncludingPurchased(ns);
  for (const server of servers) {
    if (server !== "home" && ns.isRunning(workScript, server)) {
      ns.scriptKill(workScript, server);
    }
  }
}

function stopAllEngines(ns: NS, logger: LoggerClient): void {
  const engines: string[] = [
    PATHS.app.engines.proto,
    PATHS.app.engines.prep,
    PATHS.app.engines.shotgun,
    PATHS.app.engines.jitBatcher,
  ].filter(Boolean) as string[];

  const procs = ns.ps("home").filter((proc) => engines.includes(proc.filename));
  for (const proc of procs) {
    ns.kill(proc.pid);
    logger.info(`Engine gestoppt für Worker-Phase: ${proc.filename}`);
  }
}

function resolveXpTarget(ns: NS): string {
  const rootedServers = getAllRootedServers(ns);

  if (rootedServers.length === 0) {
    return "n00dles";
  }

  if (rootedServers.includes("joesguns")) {
    return "joesguns";
  }

  const playerSkill = ns.getHackingLevel();
  const validTargets = rootedServers
    .map((host) => ns.getServer(host))
    .filter((server) => (server.requiredHackingSkill ?? 0) <= playerSkill)
    .sort((a, b) => (a.minDifficulty ?? 99) - (b.minDifficulty ?? 99));

  return validTargets.length > 0 ? validTargets[0].hostname : "n00dles";
}

function getAllRootedServers(ns: NS): string[] {
  return getAllRootedServersIncludingPurchased(ns).filter(
    (s) => !s.startsWith("cloud-") && s !== "home",
  );
}

function getAllRootedServersIncludingPurchased(ns: NS): string[] {
  const visited = new Set<string>();
  const queue = ["home"];
  const rootedTargets: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    visited.add(current);

    if (ns.hasRootAccess(current)) {
      rootedTargets.push(current);
    }

    for (const neighbor of ns.scan(current)) {
      if (!visited.has(neighbor) && !queue.includes(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  return rootedTargets;
}

function ensureEngineRunning(
  ns: NS,
  strategy: BatchStrategy,
  target: string,
  logger: LoggerClient,
): void {
  const engineMap: Partial<Record<BatchStrategy, string>> = {
    XP_GRIND: PATHS.app.engines.proto,
    PREP: PATHS.app.engines.prep,
    PROTO_BATCH: PATHS.app.engines.prep,
    SHOTGUN_HWGW: PATHS.app.engines.shotgun,
    JIT_HWGW: PATHS.app.engines.jitBatcher,
  };

  const scriptPath = engineMap[strategy];

  if (!scriptPath) {
    logger.error(
      `Keine Engine-Route für Strategie '${strategy}' konfiguriert!`,
      target,
    );
    return;
  }

  if (!ns.fileExists(scriptPath)) {
    logger.error(`Engine-Datei '${scriptPath}' wurde nicht gefunden!`, target);
    return;
  }

  const allEnginePaths = new Set(
    Object.values(engineMap).filter((p): p is string => Boolean(p)),
  );

  const runningEngineProcs = ns
    .ps("home")
    .filter((proc) => allEnginePaths.has(proc.filename));

  const isExactRunning = runningEngineProcs.some(
    (proc) => proc.filename === scriptPath && proc.args[0] === target,
  );

  if (!isExactRunning) {
    for (const proc of runningEngineProcs) {
      if (ns.kill(proc.pid)) {
        logger.info(
          `Alte Engine beendet (PID ${proc.pid}: ${proc.filename} -> ${proc.args[0]})`,
          target,
        );
      }
    }

    const requiredRam = ns.getScriptRam(scriptPath);
    const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");

    if (requiredRam <= freeRam) {
      const pid = ns.run(scriptPath, 1, target);
      if (pid > 0) {
        logger.success(
          `Engine gestartet: ${scriptPath} auf ${target} (PID: ${pid})`,
          target,
          { context: { pid, strategy, scriptPath } },
        );
      } else {
        logger.error(`Fehler beim Starten der Engine: ${scriptPath}`, target);
      }
    } else {
      logger.warn(
        `Zu wenig RAM auf 'home' für ${scriptPath} (${requiredRam} GB benötigt, ${freeRam.toFixed(2)} GB frei)`,
        target,
        { context: { requiredRam, freeRam } },
      );
    }
  }
}
