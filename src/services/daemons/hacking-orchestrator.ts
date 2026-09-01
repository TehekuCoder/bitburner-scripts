import { NS } from "@ns";

import { BatchStrategy } from "/shared/types/batcher.js";
import { PATHS } from "../../infrastructure/runtime/paths.js";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { evaluateHackingStrategy } from "/domain/evaluators/strategy/hacking-strategy.js";
import { evaluateTargets, selectBestTarget } from "/domain/evaluators/strategy/target-selection.js";
import { patchBatcherState } from "/infrastructure/state/state.js";
import {
  getAllRootedServers,
  getAllRootedServersIncludingPurchased,
} from "/infrastructure/network/network.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const logger = new LoggerClient(ns, "HACKING-ORCHESTRATOR");
  logger.info("🚀 Hacking Orchestrator erfolgreich gestartet");

  let lastStrategy: BatchStrategy | null = null;
  let lastTarget: string | null = null;
  let lastTargetChangeTime = 0;

  let lastStrategyChangeTime = 0;
  const STRATEGY_COOLDOWN_MS = 30_000;

  // 🚨 Strategien, die den Cooldown ohne Verzögerung umgehen
  const EMERGENCY_STRATEGIES: BatchStrategy[] = ["PREP", "XP_GRIND", "WORKER"];

  const JIT_DASHBOARD = PATHS.infrastructure.monitoring.jitDashboard;
  const ENGINE_DASHBOARD = PATHS.infrastructure.monitoring.dashboard;

  while (true) {
    const evalRec = evaluateHackingStrategy(ns, lastStrategy);
    const proposedStrategy: BatchStrategy = evalRec.strategy;
    const now = Date.now();

    let activeStrategy = proposedStrategy;

    if (lastStrategy !== null && proposedStrategy !== lastStrategy) {
      const timeSinceLastChange = now - lastStrategyChangeTime;
      const isEmergencySwitch = EMERGENCY_STRATEGIES.includes(proposedStrategy);

      // Cooldown greift nur, wenn es KEIN Notfall-Wechsel ist
      if (!isEmergencySwitch && timeSinceLastChange < STRATEGY_COOLDOWN_MS) {
        const remainingSec = (
          (STRATEGY_COOLDOWN_MS - timeSinceLastChange) /
          1000
        ).toFixed(1);

        activeStrategy = lastStrategy;

        logger.debug(
          `Strategiewechsel zu ${proposedStrategy} blockiert (Cooldown: noch ${remainingSec}s)`,
          undefined,
          {
            context: {
              proposedStrategy,
              currentStrategy: lastStrategy,
              remainingSec,
            },
          },
        );
      } else {
        // Wechsel wird durchgeführt (Cooldown abgelaufen ODER Notfall)
        if (isEmergencySwitch) {
          logger.warn(
            `🚨 Sofortiger Notfall-Strategiewechsel zu ${proposedStrategy} (Cooldown umgangen)`,
            undefined,
            { context: { proposedStrategy, previousStrategy: lastStrategy } },
          );
        }

        lastStrategyChangeTime = now;
      }
    } else if (lastStrategy === null) {
      lastStrategyChangeTime = now;
    }

    // 2️⃣ Target-Ermittlung
    let candidateTarget = evalRec.preferredTarget ?? resolveXpTarget(ns);

    if (activeStrategy === "XP_GRIND") {
      const daemon = "w0r1d_d43m0n";
      const hasDaemonRoot = ns.serverExists(daemon) && ns.hasRootAccess(daemon);
      const reqSkill = hasDaemonRoot
        ? (ns.getServer(daemon).requiredHackingSkill ?? 9999)
        : 9999;
      const playerSkill = ns.getHackingLevel();

      if (hasDaemonRoot && playerSkill >= reqSkill) {
        candidateTarget = daemon;
      } else if (!evalRec.preferredTarget) {
        candidateTarget = resolveXpTarget(ns);
      }
    }

    // 🛡️ Absicherung bei fehlendem Root
    if (!ns.hasRootAccess(candidateTarget)) {
      const fallbackTarget = resolveXpTarget(ns);
      logger.warn(
        `Target '${candidateTarget}' hat keinen Root-Zugriff. Fallback auf '${fallbackTarget}'`,
        candidateTarget,
      );
      candidateTarget = fallbackTarget;
    }

    const targets = evaluateTargets(ns, activeStrategy);

    const targetSelection = selectBestTarget(
      ns,
      targets,
      lastTarget,
      lastTargetChangeTime,
      {
        switchMargin: 1.15, // Neuer Server muss 15% besser sein
        minHoldMs: 60_000, // Mindestens 60s auf einem Ziel bleiben
      },
    );

    if (targetSelection.hasChanged) {
      logger.info(`🎯 Target-Wechsel: ${targetSelection.reason}`);
      lastTargetChangeTime = Date.now();
    }

    const activeTarget = targetSelection.target;
    lastTarget = candidateTarget;

    // 3️⃣ PREP-Check: Server muss erst vorbereitet werden, bevor HWGW/PROTO laufen kann
    if (
      ns.hasRootAccess(candidateTarget) &&
      activeStrategy !== "XP_GRIND" &&
      activeStrategy !== "WORKER" &&
      activeStrategy !== "BOOTSTRAP"
    ) {
      const server = ns.getServer(candidateTarget);
      const isMaxMoney =
        (server.moneyAvailable ?? 0) >= (server.moneyMax ?? 1) * 0.99;
      const isMinSec =
        (server.hackDifficulty ?? 99) <= (server.minDifficulty ?? 1) + 0.05;

      if (!isMaxMoney || !isMinSec) {
        activeStrategy = "PREP";
      }
    }

    // 📊 Statusänderungen protokollieren
    if (activeStrategy !== lastStrategy || candidateTarget !== lastTarget) {
      logger.info(
        `Strategie-Wechsel: ${activeStrategy} | Target: ${candidateTarget}`,
        candidateTarget,
        { context: { strategy: activeStrategy, target: candidateTarget } },
      );
      lastStrategy = activeStrategy;
      lastTarget = candidateTarget;
    }

    // 4️⃣ State aktualisieren
    patchBatcherState(ns, {
      batchStrategy: activeStrategy,
      batcherTarget: candidateTarget,
      batcherActive: true,
      batcherProgress:
        activeStrategy === "XP_GRIND"
          ? `XP-Grind aktiv auf ${candidateTarget}`
          : `Laufende Strategie: ${activeStrategy}`,
    });

    // 5️⃣ Engine starten ODER Multi-Target Worker im Netzwerk verteilen
    if (ns.hasRootAccess(candidateTarget)) {
      if (activeStrategy === "BOOTSTRAP" || activeStrategy === "WORKER") {
        stopAllEngines(ns, logger);

        const allServers = getAllRootedServersIncludingPurchased(ns);
        const totalNetworkRam = allServers.reduce(
          (sum, s) => sum + ns.getServerMaxRam(s),
          0,
        );

        let maxTargets = 1;
        if (totalNetworkRam >= 2048) {
          maxTargets = 5;
        } else if (totalNetworkRam >= 512) {
          maxTargets = 3;
        } else if (totalNetworkRam >= 128) {
          maxTargets = 2;
        }

        const evalTargets = evaluateTargets(ns, activeStrategy);
        const topTargets =
          evalTargets.length > 0
            ? evalTargets.slice(0, maxTargets).map((t) => t.hostname)
            : [candidateTarget];

        deployWorkerFleet(ns, logger, allServers, topTargets);
      } else {
        stopNetworkWorkers(ns);
        ensureEngineRunning(ns, activeStrategy, candidateTarget, logger);
      }
    } else {
      logger.error(
        `Kein Root-Zugriff auf ${candidateTarget} vorhanden! Engine gestoppt.`,
        candidateTarget,
      );
    }

    // 6️⃣ Dashboards verwalten
    manageDashboards(
      ns,
      activeStrategy,
      JIT_DASHBOARD,
      ENGINE_DASHBOARD,
      logger,
    );

    await ns.sleep(5000);
  }
}

function manageDashboards(
  ns: NS,
  activeStrategy: BatchStrategy | null,
  jitDash: string,
  engineDash: string,
  logger: LoggerClient,
): void {
  const isWorkerPhase =
    activeStrategy === "BOOTSTRAP" || activeStrategy === "WORKER";

  const activeDashboardScript =
    activeStrategy === "JIT_HWGW"
      ? jitDash
      : activeStrategy !== null && !isWorkerPhase
        ? engineDash
        : null;

  for (const dashScript of [jitDash, engineDash]) {
    if (!dashScript) continue;

    if (dashScript === activeDashboardScript) {
      if (
        ns.fileExists(dashScript, "home") &&
        !ns.isRunning(dashScript, "home")
      ) {
        const freeRam =
          ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
        const requiredRam = ns.getScriptRam(dashScript, "home");

        if (freeRam >= requiredRam) {
          const pid = ns.run(dashScript, 1);
          if (pid > 0) {
            logger.info(`📊 Dashboard gestartet: ${dashScript}`, undefined, {
              context: { pid, dashScript },
            });
          }
        }
      }
    } else if (ns.isRunning(dashScript, "home")) {
      ns.scriptKill(dashScript, "home");
      logger.info(`⏹️ Dashboard beendet: ${dashScript}`, undefined, {
        context: { dashScript },
      });
    }
  }
}

interface FleetNode {
  host: string;
  freeRam: number;
}

export function deployWorkerFleet(
  ns: NS,
  logger: LoggerClient,
  servers: string[],
  targets: string[],
  workerScript: string = PATHS.services.payloads.work,
): void {
  if (targets.length === 0 || servers.length === 0) {
    logger.warn("Keine Targets oder Server für Fleet-Deployment übergeben.");
    return;
  }

  const scriptRam = ns.getScriptRam(workerScript);

  // 1. Freien RAM im gesamten Netzwerk aggregieren
  const pool: FleetNode[] = servers
    .map((host) => {
      const maxRam = ns.getServerMaxRam(host);
      const usedRam = getScriptUsedRam(ns, host, workerScript);
      const reserved = host === "home" ? 32 : 0;
      return { host, freeRam: Math.max(0, maxRam - usedRam - reserved) };
    })
    .filter((node) => node.freeRam >= scriptRam)
    .sort((a, b) => b.freeRam - a.freeRam);

  const totalFleetRam = pool.reduce((sum, node) => sum + node.freeRam, 0);
  if (totalFleetRam <= 0) return;

  // 2. RAM-Verteilung auf die besten Targets definieren (60% / 25% / 15%)
  const weights = [0.6, 0.25, 0.15];
  const targetBudgets = targets.slice(0, weights.length).map((target, idx) => ({
    target,
    remainingBudget: totalFleetRam * weights[idx],
  }));

  logger.info(
    `Fleet-Pool: ${ns.format.number(totalFleetRam, 0)} GB RAM verfügbar für ${targetBudgets.length} Targets.`,
  );

  // 3. Budgets sequenziell über den Server-Pool abarbeiten
  let targetIndex = 0;

  for (const node of pool) {
    while (node.freeRam >= scriptRam && targetIndex < targetBudgets.length) {
      const currentTarget = targetBudgets[targetIndex];
      const allocatableRam = Math.min(
        node.freeRam,
        currentTarget.remainingBudget,
      );
      const threads = Math.floor(allocatableRam / scriptRam);

      if (threads > 0) {
        ns.exec(workerScript, node.host, threads, currentTarget.target);
        const used = threads * scriptRam;
        node.freeRam -= used;
        currentTarget.remainingBudget -= used;
      }

      if (currentTarget.remainingBudget < scriptRam) {
        targetIndex++;
      }
    }
  }
}

function getScriptUsedRam(ns: NS, server: string, script: string): number {
  const scriptName = script.replace(/^.*[\\/]/, "");
  return ns
    .ps(server)
    .filter((p) => p.filename.endsWith(scriptName))
    .reduce((acc, p) => acc + p.threads * ns.getScriptRam(script, server), 0);
}

function stopNetworkWorkers(ns: NS): void {
  const workScript = PATHS.services.payloads.work;
  const scriptName = workScript.replace(/^.*[\\/]/, "");
  const servers = getAllRootedServersIncludingPurchased(ns);

  for (const server of servers) {
    for (const proc of ns.ps(server)) {
      if (proc.filename.endsWith(scriptName)) {
        ns.kill(proc.pid);
      }
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

function ensureEngineRunning(
  ns: NS,
  strategy: BatchStrategy,
  target: string,
  logger: LoggerClient,
): void {
  const engineMap: Partial<Record<BatchStrategy, string>> = {
    XP_GRIND: PATHS.app.engines.proto,
    PREP: PATHS.app.engines.prep,
    PROTO_BATCH: PATHS.app.engines.proto,
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
