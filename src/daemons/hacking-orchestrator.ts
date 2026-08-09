import { NS } from "@ns";
import { loadBatcherState, patchBatcherState } from "/lib/state.js";
import { evaluateHackingStrategy } from "/lib/evaluators/strategy/hacking-strategy.js";
import { BatchStrategy } from "/lib/types/batcher.js";
import { PATHS } from "/lib/paths";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  while (true) {
    const currentState = loadBatcherState(ns);
    const evalRec = evaluateHackingStrategy(ns);

    // 1️⃣ Strategie-Ermittlung: batchStrategy prüfen
    let activeStrategy: BatchStrategy = evalRec.strategy;
    if (currentState?.batchStrategy === "XP_GRIND") {
      activeStrategy = "XP_GRIND";
    }

    // 2️⃣ Target-Ermittlung für XP_GRIND
    let activeTarget = evalRec.preferredTarget ?? "joesguns";

    if (activeStrategy === "XP_GRIND") {
      const daemon = "w0r1d_d43m0n";
      const hasDaemonRoot = ns.serverExists(daemon) && ns.hasRootAccess(daemon);
      const reqSkill = hasDaemonRoot
        ? (ns.getServer(daemon).requiredHackingSkill ?? 9999)
        : 9999;
      const playerSkill = ns.getHackingLevel();

      if (hasDaemonRoot && playerSkill >= reqSkill) {
        activeTarget = daemon;
      } else {
        activeTarget = "joesguns";
      }
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

    // 4️⃣ Engine starten / umschalten
    ensureEngineRunning(ns, activeStrategy, activeTarget);

    await ns.sleep(5000);
  }
}

function ensureEngineRunning(
  ns: NS,
  strategy: BatchStrategy,
  target: string,
): void {
  // Partial<Record<...>> verhindert Type-Errors bei unvollständiger Map
  const engineMap: Partial<Record<BatchStrategy, string>> = {
    XP_GRIND: PATHS.core.engines.proto,
    WORKER: PATHS.core.engines.proto,
    BOOTSTRAP: PATHS.core.engines.proto,
    PREP: PATHS.core.engines.prep,
    PROTO_BATCH: PATHS.core.engines.prep,
    SHOTGUN_HWGW: PATHS.core.engines.shotgun,
    JIT_HWGW: PATHS.core.engines.jitBatcher,
  };

  const scriptPath = engineMap[strategy];
  if (!scriptPath || !ns.fileExists(scriptPath)) return;

  const isRunning = ns
    .ps("home")
    .some((proc) => proc.filename === scriptPath && proc.args[0] === target);

  if (!isRunning) {
    Object.values(engineMap).forEach((path) => {
      if (path && path !== scriptPath) ns.scriptKill(path, "home");
    });

    if (
      ns.getScriptRam(scriptPath) <=
      ns.getServerMaxRam("home") - ns.getServerUsedRam("home")
    ) {
      ns.run(scriptPath, 1, target);
    }
  }
}
