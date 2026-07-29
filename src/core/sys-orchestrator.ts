import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { getAllServers, getNetworkMaxRam } from "/lib/network.js";
import { patchState } from "/lib/state.js";
import { BatchStrategy } from "/lib/types.js";
import { PATH_HACK, PATH_GROW, PATH_WEAKEN } from "/lib/constants.js";
import { PATHS } from "/lib/paths";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Orchestrator");

  const DASHBOARD_SCRIPT = "core/sys-jit-batcher-dashboard.js";

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

  // ----------------------------------------------------------------------
  // 1️⃣ GLOBALE STRATEGIEN
  // ----------------------------------------------------------------------
  if (hackingEfficiency === 0 || ns.getPlayer().skills.hacking < 30) {
    return { strategy: "XP_GRIND", target: "joesguns" };
  }

  // Bis 128GB Gesamtsystem-RAM nutzt die Engine BOOTSTRAP / Early-Prep
  if (totalRam < 128) {
    const playerHack = ns.getPlayer().skills.hacking;
    const canHackJoesguns = ns.hasRootAccess("joesguns") && playerHack >= 10;
    const bootstrapTarget = canHackJoesguns ? "joesguns" : "n00dles";

    return { strategy: "BOOTSTRAP", target: bootstrapTarget };
  }

  const homeRam = ns.getServerMaxRam("home");
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  if (totalRam >= 512 && homeRam >= 1024 && hasFormulas) {
    return { strategy: "JIT_HWGW", target: currentTarget ?? "n00dles" };
  }

  // ----------------------------------------------------------------------
  // 2️⃣ HYSTERESE FÜR SHOTGUN_HWGW (Verhindert Target-Jumping)
  // ----------------------------------------------------------------------
  if (
    currentStrategy === "SHOTGUN_HWGW" &&
    currentTarget &&
    ns.serverExists(currentTarget)
  ) {
    const sObj = ns.getServer(currentTarget);
    const curDiff = sObj.hackDifficulty ?? 99;
    const minDiff = sObj.minDifficulty ?? 1;

    // Solange das aktuelle Ziel nicht massiv destabilisiert ist, bleiben wir dabei
    if (curDiff - minDiff <= 20.0) {
      return { strategy: "SHOTGUN_HWGW", target: currentTarget };
    }
  }

  // ----------------------------------------------------------------------
  // 3️⃣ ZIEL-EVALUIERUNG (PREP / SHOTGUN)
  // ----------------------------------------------------------------------
  const target = selectBestTarget(ns, servers, currentTarget);
  if (!target) {
    return { strategy: "PREP", target: "n00dles" };
  }

  const sObj = ns.getServer(target);
  const currentDiff = sObj.hackDifficulty ?? 99;
  const minDiff = sObj.minDifficulty ?? 1;
  const currentMoney = sObj.moneyAvailable ?? 0;
  const maxMoney = sObj.moneyMax ?? 1;

  const isPrepped =
    currentDiff - minDiff <= 0.05 &&
    (maxMoney > 0 ? currentMoney / maxMoney >= 0.98 : true);

  if (!isPrepped) {
    return { strategy: "PREP", target };
  }

  // Sobald das Ziel prepped ist, geht es in die SHOTGUN Engine
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

    // 🟢 Nur wechseln, wenn das neue Ziel spürbar mehr Geld bringt
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
      // Nutzt jetzt das dynamisch ermittelte targetArg anstelle des hardgecodeten "n00dles"
      return ns.run(PATHS.core.engines.prep, 1, targetArg);

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
