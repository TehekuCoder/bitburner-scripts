import { NS } from "@ns";
import { getAllServers } from "../lib/network.js";
import { getNetworkMaxRam } from "../lib/ram-utils.js";
import { Logger } from "./logger.js";
import { patchState } from "./state-manager.js";
import { BatchStrategy } from "./types.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(
    ns,
    "Orchestrator",
    "INFO",
    "/logs/sys-orchestrator.txt",
  );

  const DASHBOARD_SCRIPT = "core/sys-jit-batcher-dashboard.js";

  let activeStrategy: BatchStrategy | null = null;
  let activeTarget: string | null = null;
  let activeProcessId = 0;

  // Multiplikatoren einmalig laden
  let bnMults: Record<string, number> = {};
  try {
    const fileContent = ns.read("/bn-multipliers.txt");
    if (fileContent) bnMults = JSON.parse(fileContent);
  } catch (_) {}

  while (true) {
    const servers = getAllServers(ns);
    const totalMaxRam = getNetworkMaxRam(ns, servers);
    const target = selectBestTarget(ns, servers, activeTarget);

    // 1. Strategie evaluieren (inkl. XP-Grind & BN-Sonderregeln)
    const desiredStrategy = determineStrategy(
      ns,
      totalMaxRam,
      target,
      activeStrategy,
      bnMults,
    );

    // 2. Prüfen, ob ein Wechsel erforderlich ist
    const strategyChanged = desiredStrategy !== activeStrategy;
    const targetChanged = target !== activeTarget;
    const processDied = activeProcessId > 0 && !ns.isRunning(activeProcessId);

    if (strategyChanged || targetChanged || processDied) {
      logger.info(
        `🔄 Statuswechsel: Strategie [${activeStrategy ?? "NONE"} ➡️ ${desiredStrategy}] | Ziel [${activeTarget ?? "NONE"} ➡️ ${target ?? "NONE"}]`,
      );

      // Laufende Alt-Prozesse beenden
      if (activeProcessId > 0 && ns.isRunning(activeProcessId)) {
        ns.kill(activeProcessId);
      }

      // Neue Execution Engine starten
      activeProcessId = switchExecutionEngine(ns, desiredStrategy, target);
      activeStrategy = desiredStrategy;
      activeTarget = target;

      // State für Dashboard und Dispatcher aktualisieren
      patchState(ns, {
        batchStrategy: desiredStrategy,
        kernelTarget: target ?? "n00dles",
      });
    }

    // 3. DASHBOARD LIFECYCLE MANAGEMENT
    if (activeStrategy === "JIT_HWGW") {
      if (
        ns.fileExists(DASHBOARD_SCRIPT, "home") &&
        !ns.isRunning(DASHBOARD_SCRIPT, "home")
      ) {
        const freeRam =
          ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
        const reqRam = ns.getScriptRam(DASHBOARD_SCRIPT, "home");

        if (freeRam >= reqRam) {
          ns.run(DASHBOARD_SCRIPT, 1);
          logger.info(`📊 JIT-Batcher Dashboard gestartet.`);
        }
      }
    } else {
      if (ns.isRunning(DASHBOARD_SCRIPT, "home")) {
        ns.scriptKill(DASHBOARD_SCRIPT, "home");
        logger.info(`⏹️ JIT-Batcher Dashboard beendet (Inaktive Strategie).`);
      }
    }

    await ns.sleep(5000);
  }
}

/**
 * Kernlogik: Wählt die richtige Batch/Prep/XP-Strategie.
 */
function determineStrategy(
  ns: NS,
  totalRam: number,
  target: string | null,
  currentStrategy: BatchStrategy | null,
  bnMults: Record<string, number>,
): BatchStrategy {
  const hackingEfficiency =
    (bnMults.ServerMaxMoney ?? 1.0) * (bnMults.ScriptHackMoneyGain ?? 1.0);

  // 1. BitNode-Sonderregel: Wenn Hacking kein Geld bringt -> XP_GRIND
  if (hackingEfficiency === 0) {
    return "XP_GRIND";
  }

  // 2. Niedriges Hacking-Level -> XP_GRIND
  if (ns.getPlayer().skills.hacking < 30) {
    return "XP_GRIND";
  }

  // 3. Sehr wenig RAM -> BOOTSTRAP
  if (totalRam < 64) {
    return "BOOTSTRAP";
  }

  if (!target) return "PREP";

  // 🧠 LAUFENDE BATCH-ENGINES NICHT VORZEITIG ABBRECHEN
  if (currentStrategy === "SHOTGUN_HWGW" || currentStrategy === "JIT_HWGW") {
    const sObj = ns.getServer(target);
    const curDiff = sObj.hackDifficulty ?? 99;
    const minDiff = sObj.minDifficulty ?? 1;

    if (curDiff - minDiff <= 20.0) {
      return currentStrategy;
    }
  }

  // Prep-Check
  const sObj = ns.getServer(target);
  const currentDiff = sObj.hackDifficulty ?? 99;
  const minDiff = sObj.minDifficulty ?? 1;
  const currentMoney = sObj.moneyAvailable ?? 0;
  const maxMoney = sObj.moneyMax ?? 1;

  const isPrepped =
    currentDiff - minDiff <= 0.05 &&
    (maxMoney > 0 ? currentMoney / maxMoney >= 0.98 : true);

  if (!isPrepped) {
    return "PREP";
  }

  const homeRam = ns.getServerMaxRam("home");
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  if (totalRam < 512) {
    return "PROTO_BATCH";
  } else if (homeRam < 2048 || !hasFormulas) {
    return "SHOTGUN_HWGW";
  } else {
    return "JIT_HWGW";
  }
}

/**
 * Startet das jeweilige Sub-System als isolierten Prozess.
 */
function switchExecutionEngine(
  ns: NS,
  strategy: BatchStrategy,
  target: string | null,
): number {
  const targetArg = target ?? "n00dles";

  switch (strategy) {
    case "BOOTSTRAP":
      return ns.run("core/engine-prep.js", 1, "n00dles");

    case "XP_GRIND":
      // joesguns ist eines der besten Ziele für schnellen XP-Gain
      return ns.run("core/engine-xp-grind.js", 1, "joesguns");

    case "PREP":
      return ns.run("core/engine-prep.js", 1, targetArg);

    case "PROTO_BATCH":
      return ns.run("core/engine-proto.js", 1, targetArg);

    case "SHOTGUN_HWGW":
      return ns.run("core/engine-shotgun.js", 1, targetArg);

    case "JIT_HWGW":
      return ns.run("core/sys-jit-batcher.js", 1, targetArg);

    default:
      return 0;
  }
}

function selectBestTarget(
  ns: NS,
  servers: string[],
  currentTarget: string | null,
): string | null {
  const playerSkill = ns.getPlayer().skills.hacking;

  const candidates = servers
    .filter(
      (s) =>
        ns.hasRootAccess(s) &&
        ns.getServerMaxMoney(s) > 0 &&
        (ns.getServerRequiredHackingLevel(s) ?? 0) <= playerSkill / 2,
    )
    .sort(
      (a, b) => (ns.getServerMaxMoney(b) ?? 0) - (ns.getServerMaxMoney(a) ?? 0),
    );

  const bestCandidate = candidates[0] ?? "n00dles";

  // Stickiness: Wechselt nur, wenn das neue Ziel deutlich mehr bringt (2.5x)
  if (currentTarget && ns.serverExists(currentTarget)) {
    const currentMaxMoney = ns.getServerMaxMoney(currentTarget);
    const bestMaxMoney = ns.getServerMaxMoney(bestCandidate);

    if (bestMaxMoney < currentMaxMoney * 2.5) {
      return currentTarget;
    }
  }

  return bestCandidate;
}