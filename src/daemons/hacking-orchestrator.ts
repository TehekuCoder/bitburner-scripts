import { NS } from "@ns";
import { loadBatcherState, patchBatcherState } from "/lib/state.js";
import { evaluateHackingStrategy } from "/lib/evaluators/strategy/hacking-strategy.js";
import { BatchStrategy } from "/lib/types/batcher.js";
import { PATHS } from "/lib/paths.js";
import { LoggerClient } from "/lib/logger-client.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const logger = new LoggerClient(ns, "HACKING-ORCHESTRATOR");
  logger.info("🚀 Hacking Orchestrator erfolgreich gestartet");

  let lastStrategy: BatchStrategy | null = null;
  let lastTarget: string | null = null;

  while (true) {
    const currentState = loadBatcherState(ns);
    const evalRec = evaluateHackingStrategy(ns);

    // 1️⃣ Strategie-Ermittlung
    let activeStrategy: BatchStrategy = evalRec.strategy;
    if (currentState?.batchStrategy === "XP_GRIND") {
      activeStrategy = "XP_GRIND";
    }

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

    // 3️⃣ State aktualisieren
    patchBatcherState(ns, {
      batchStrategy: activeStrategy,
      batcherTarget: activeTarget,
      batcherProgress:
        activeStrategy === "XP_GRIND"
          ? `XP-Grind aktiv auf ${activeTarget}`
          : `Laufende Strategie: ${activeStrategy}`,
    });

    // 4️⃣ Engine starten
    if (ns.hasRootAccess(activeTarget)) {
      ensureEngineRunning(ns, activeStrategy, activeTarget, logger);
    } else {
      logger.error(
        `Kein Root-Zugriff auf ${activeTarget} vorhanden! Engine gestoppt.`,
        activeTarget,
      );
    }

    await ns.sleep(5000);
  }
}

function resolveXpTarget(ns: NS): string {
  const rootedServers = getAllRootedServers(ns);

  if (rootedServers.length === 0) {
    return "n00dles";
  }

  // 1. Primärziel "joesguns" bevorzugen, sofern gerootet (optimales XP/Zeit-Verhältnis im Early Game)
  if (rootedServers.includes("joesguns")) {
    return "joesguns";
  }

  // 2. Dynamische Auswahl: Sortiere nach niedrigster Min-Security für maximale Ausführungsgeschwindigkeit
  const playerSkill = ns.getHackingLevel();
  const validTargets = rootedServers
    .map((host) => ns.getServer(host))
    .filter((server) => (server.requiredHackingSkill ?? 0) <= playerSkill)
    .sort((a, b) => (a.minDifficulty ?? 99) - (b.minDifficulty ?? 99));

  return validTargets.length > 0 ? validTargets[0].hostname : "n00dles";
}

/**
 * Scannt rekursiv das gesamte Netzwerk nach allen Geräten mit Root-Zugriff (exkl. Home & Purchased)
 */
function getAllRootedServers(ns: NS): string[] {
  const visited = new Set<string>();
  const queue = ["home"];
  const rootedTargets: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    visited.add(current);

    const isPurchased = current.startsWith("pserv-") || current === "home";
    if (!isPurchased && ns.hasRootAccess(current)) {
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
    BOOTSTRAP: PATHS.payloads.work,
    WORKER: PATHS.payloads.work,
    XP_GRIND: PATHS.core.engines.proto,
    PREP: PATHS.core.engines.prep,
    PROTO_BATCH: PATHS.core.engines.prep,
    SHOTGUN_HWGW: PATHS.core.engines.shotgun,
    JIT_HWGW: PATHS.core.engines.jitBatcher,
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

  const isRunning = ns
    .ps("home")
    .some((proc) => proc.filename === scriptPath && proc.args[0] === target);

  if (!isRunning) {
    Object.values(engineMap).forEach((path) => {
      if (path && path !== scriptPath && ns.fileExists(path)) {
        if (ns.scriptKill(path, "home")) {
          logger.info(`Alte Engine beendet: ${path}`, target);
        }
      }
    });

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
