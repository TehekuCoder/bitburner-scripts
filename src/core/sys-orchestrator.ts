import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { getAllServers, getNetworkMaxRam } from "/lib/network.js";
import { patchState } from "/lib/state.js";
import { BatchStrategy } from "/lib/types/batcher.js";
import { PATH_HACK, PATH_GROW, PATH_WEAKEN } from "/lib/constants.js";
import { PATHS } from "/lib/paths";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Orchestrator");

  const JIT_DASHBOARD = "core/sys-jit-batcher-dashboard.js";
  const SHOTGUN_DASHBOARD = "core/sys-shotgun-dashboard.js";

  let activeStrategy: BatchStrategy | null = null;
  let activeTarget: string | null = null;
  let activeProcessId = 0;

  // 🧹 0. Beim Start des Orchestrators ALLE alten Engines auf home Killen
  stopAllEngines(ns);

  // Multiplikatoren einmalig laden
  let bnMults: Record<string, number> = {};
  try {
    const fileContent = ns.read("/bn-multipliers.txt");
    if (fileContent) bnMults = JSON.parse(fileContent);
  } catch (_) {}

  while (true) {
    const servers = getAllServers(ns);
    const totalMaxRam = getNetworkMaxRam(ns, servers);

    // 1. Strategie & Target evaluieren
    const { strategy: desiredStrategy, target } = evaluateStrategyAndTarget(
      ns,
      servers,
      totalMaxRam,
      activeStrategy,
      activeTarget,
      bnMults,
    );

    // 2. Prüfen, ob ein Wechsel erforderlich ist
    const strategyChanged = desiredStrategy !== activeStrategy;
    const targetChanged =
      desiredStrategy !== "JIT_HWGW" && target !== activeTarget;
    const processDied = activeProcessId > 0 && !ns.isRunning(activeProcessId);

    if (strategyChanged || targetChanged || processDied) {
      logger.info(
        `🔄 Statuswechsel: Strategie [${activeStrategy ?? "NONE"} ➡️ ${desiredStrategy}] | Ziel [${activeTarget ?? "NONE"} ➡️ ${target ?? "NONE"}]`,
      );

      // Alt-Engines & Payloads im gesamten Netzwerk radikal säubern
      stopAllEngines(ns);
      killAllWorkerPayloads(ns, servers);

      // Neue Execution Engine starten
      const newPid = switchExecutionEngine(ns, desiredStrategy, target);

      if (newPid > 0) {
        activeProcessId = newPid;
        activeStrategy = desiredStrategy;
        activeTarget = target;
      } else {
        logger.error(
          `❌ Konnte Engine für [${desiredStrategy}] nicht starten! (Zu wenig RAM auf home?)`,
        );
        activeStrategy = null;
        activeTarget = null;
        activeProcessId = 0;
      }

      // State für Dashboard und Dispatcher aktualisieren
      patchState(ns, {
        batchStrategy: desiredStrategy,
        kernelTarget: target ?? "n00dles",
      });
    }

    // 3. DASHBOARD LIFECYCLE MANAGEMENT (Dynamic Toggle)
    const activeDashboardScript =
      activeStrategy === "JIT_HWGW"
        ? JIT_DASHBOARD
        : activeStrategy === "SHOTGUN_HWGW"
        ? SHOTGUN_DASHBOARD
        : null;

    const knownDashboards = [JIT_DASHBOARD, SHOTGUN_DASHBOARD];

    for (const dashScript of knownDashboards) {
      if (dashScript === activeDashboardScript) {
        // Dashboard soll laufen -> Starten falls noch inaktiv
        if (
          ns.fileExists(dashScript, "home") &&
          !ns.isRunning(dashScript, "home")
        ) {
          const freeRam =
            ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
          const reqRam = ns.getScriptRam(dashScript, "home");

          if (freeRam >= reqRam) {
            ns.run(dashScript, 1);
            logger.info(`📊 Dashboard gestartet: ${dashScript}`);
          }
        }
      } else {
        // Nicht passendes Dashboard beenden
        if (ns.isRunning(dashScript, "home")) {
          ns.scriptKill(dashScript, "home");
          logger.info(`⏹️ Dashboard beendet: ${dashScript}`);
        }
      }
    }

    await ns.sleep(5000);
  }
}

/**
 * Stoppt rigoros alle bekannten Engine-Skripte auf home.
 */
function stopAllEngines(ns: NS): void {
  const enginePaths = Object.values(PATHS.core.engines);
  const runningProcs = ns.ps("home");

  for (const proc of runningProcs) {
    if (proc.pid === ns.pid) continue; // Orchestrator nicht selbst beenden

    const isEngine = enginePaths.some(
      (engineScript) =>
        proc.filename === engineScript || proc.filename.includes(engineScript),
    );

    if (isEngine) {
      ns.kill(proc.pid);
    }
  }
}

/**
 * Kernlogik: Wählt die richtige Strategie UND das passendste Ziel aus.
 */
function evaluateStrategyAndTarget(
  ns: NS,
  servers: string[],
  totalRam: number,
  currentStrategy: BatchStrategy | null,
  currentTarget: string | null,
  bnMults: Record<string, number>,
): { strategy: BatchStrategy; target: string | null } {
  const hackingEfficiency =
    (bnMults.ServerMaxMoney ?? 1.0) * (bnMults.ScriptHackMoneyGain ?? 1.0);

  // 1️⃣ XP-GRIND Check
  if (hackingEfficiency === 0 || ns.getPlayer().skills.hacking < 30) {
    return { strategy: "XP_GRIND", target: "joesguns" };
  }

  const homeRam = ns.getServerMaxRam("home");
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  // 2️⃣ BOOTSTRAP / PROTO: Solange home < 256 GB RAM hat
  if (homeRam < 256) {
    const target = selectBestTarget(ns, servers, currentTarget) ?? "joesguns";
    return { strategy: "BOOTSTRAP", target };
  }

  // 3️⃣ JIT_HWGW: Ab 512 GB home-RAM + Formulas
  if (homeRam >= 512 && hasFormulas) {
    return { strategy: "JIT_HWGW", target: currentTarget ?? "n00dles" };
  }

  // 4️⃣ SHOTGUN / PREP: Für den Übergang
  const target = selectBestTarget(ns, servers, currentTarget);
  if (!target) {
    return { strategy: "PREP", target: "n00dles" };
  }

  const sObj = ns.getServer(target);
  const currentDiff = sObj.hackDifficulty ?? 99;
  const minDiff = sObj.minDifficulty ?? 1;
  const currentMoney = sObj.moneyAvailable ?? 0;
  const maxMoney = sObj.moneyMax ?? 1;

  if (currentStrategy === "SHOTGUN_HWGW" && target === currentTarget) {
    const isSeverelyDamaged =
      (maxMoney > 0 && currentMoney / maxMoney < 0.5) ||
      currentDiff - minDiff > 5.0;

    if (!isSeverelyDamaged) {
      return { strategy: "SHOTGUN_HWGW", target };
    }
  }

  const isPrepped =
    currentDiff - minDiff <= 0.05 &&
    (maxMoney > 0 ? currentMoney / maxMoney >= 0.98 : true);

  if (!isPrepped) {
    return { strategy: "PREP", target };
  }

  return { strategy: "SHOTGUN_HWGW", target };
}

/**
 * Wählt das lukrativste Ziel aus.
 */
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
        (ns.getServerRequiredHackingLevel(s) ?? 0) <= playerSkill,
    )
    .sort(
      (a, b) => (ns.getServerMaxMoney(b) ?? 0) - (ns.getServerMaxMoney(a) ?? 0),
    );

  const bestCandidate = candidates[0] ?? "n00dles";

  if (currentTarget && ns.serverExists(currentTarget)) {
    const currentMaxMoney = ns.getServerMaxMoney(currentTarget);
    const bestMaxMoney = ns.getServerMaxMoney(bestCandidate);

    const threshold = playerSkill < 300 ? 1.3 : 1.8;

    const isBestSignificantlyBetter =
      bestMaxMoney > currentMaxMoney * threshold;

    if (!isBestSignificantlyBetter) {
      return currentTarget;
    }
  }

  return bestCandidate;
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
      return ns.run(PATHS.core.engines.proto, 1, targetArg);

    case "XP_GRIND":
      return ns.run(PATHS.core.engines.xpGrind, 1, "joesguns");

    case "PREP":
      return ns.run(PATHS.core.engines.prep, 1, targetArg);

    case "SHOTGUN_HWGW":
      return ns.run(PATHS.core.engines.shotgun, 1, targetArg);

    case "JIT_HWGW":
      return ns.run(PATHS.core.engines.jitBatcher, 1, targetArg);

    default:
      return 0;
  }
}

/**
 * Beendet gezielt alle H/G/W & Early-Fleet Payload-Prozesse im Netzwerk inklusive home.
 */
function killAllWorkerPayloads(ns: NS, servers: string[]): void {
  const payloadScripts = [
    PATH_HACK,
    PATH_GROW,
    PATH_WEAKEN,
    "payloads/weaken.js",
    "payloads/grow.js",
    "payloads/hack.js",
    PATHS.payloads.work,
    "payloads/work.js",
  ];

  for (const server of servers) {
    if (!ns.hasRootAccess(server)) continue;
    for (const proc of ns.ps(server)) {
      if (payloadScripts.some((script) => proc.filename.includes(script))) {
        ns.kill(proc.pid);
      }
    }
  }
}