import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { getAllServers, getNetworkMaxRam } from "/lib/network.js";
import { patchState } from "/lib/state.js";
import { BatchStrategy } from "/lib/types/batcher.js";
import { PATHS } from "/lib/paths.js";
import { loadBnMults } from "/lib/utils";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Orchestrator");

  const JIT_DASHBOARD = "core/sys-jit-batcher-dashboard.js";
  const SHOTGUN_DASHBOARD = "core/sys-shotgun-dashboard.js";

  let activeStrategy: BatchStrategy | null = null;
  let activeTarget: string | null = null;
  let activeProcessId = 0;

  stopAllEngines(ns);

  let bnMults = loadBnMults(ns);
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

    // 2. Wechsel-Bedingungen prüfen
    const strategyChanged = desiredStrategy !== activeStrategy;

    // Bei JIT_HWGW steuert der Daemon die Ziele selbst -> Zielwechsel ignoriere
    const targetChanged =
      desiredStrategy !== "JIT_HWGW" && target !== activeTarget;

    const processDied = activeProcessId > 0 && !ns.isRunning(activeProcessId);

    if (strategyChanged || targetChanged || processDied) {
      logger.info(
        `🔄 Statuswechsel: Strategie [${activeStrategy ?? "NONE"} ➡️ ${desiredStrategy}] | Ziel [${activeTarget ?? "MULTI"} ➡️ ${target ?? "MULTI"}]`,
      );

      stopAllEngines(ns);
      killAllWorkerPayloads(ns, servers);

      const newPid = switchExecutionEngine(ns, desiredStrategy, target);

      if (newPid > 0) {
        activeProcessId = newPid;
        activeStrategy = desiredStrategy;
        activeTarget = desiredStrategy === "JIT_HWGW" ? null : target;
      } else {
        logger.error(
          `❌ Konnte Engine für [${desiredStrategy}] nicht starten! (Zu wenig RAM auf home?)`,
        );
        activeStrategy = null;
        activeTarget = null;
        activeProcessId = 0;
      }

      patchState(ns, {
        batchStrategy: desiredStrategy,
        kernelTarget: target ?? "Multi-Target",
      });
    }

    // 3. DASHBOARD LIFECYCLE
    const activeDashboardScript =
      activeStrategy === "JIT_HWGW"
        ? JIT_DASHBOARD
        : activeStrategy === "SHOTGUN_HWGW"
          ? SHOTGUN_DASHBOARD
          : null;

    const knownDashboards = [JIT_DASHBOARD, SHOTGUN_DASHBOARD];

    for (const dashScript of knownDashboards) {
      if (dashScript === activeDashboardScript) {
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
        if (ns.isRunning(dashScript, "home")) {
          ns.scriptKill(dashScript, "home");
          logger.info(`⏹️ Dashboard beendet: ${dashScript}`);
        }
      }
    }

    await ns.sleep(5000);
  }
}

function stopAllEngines(ns: NS): void {
  const enginePaths = Object.values(PATHS.core.engines);
  const runningProcs = ns.ps("home");

  for (const proc of runningProcs) {
    if (proc.pid === ns.pid) continue;

    const isEngine = enginePaths.some((engineScript) =>
      proc.filename.endsWith(engineScript.replace(/^.*[\\/]/, "")),
    );

    if (isEngine) {
      ns.kill(proc.pid);
    }
  }
}

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

  // 2️⃣ JIT_HWGW: Ab 512 GB home-RAM + Formulas (Autonomes Multi-Targeting)
  if (homeRam >= 512 && hasFormulas) {
    return { strategy: "JIT_HWGW", target: null };
  }

  const bestTarget = selectBestTarget(ns, servers, currentTarget) ?? "n00dles";

  // 3️⃣ BOOTSTRAP / PROTO: home < 256 GB RAM
  if (homeRam < 256) {
    return { strategy: "BOOTSTRAP", target: bestTarget };
  }

  // 4️⃣ SHOTGUN / PREP (Single-Target Fallbacks)
  const target = bestTarget;
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

function selectBestTarget(
  ns: NS,
  servers: string[],
  currentTarget: string | null,
): string | null {
  const playerSkill = ns.getPlayer().skills.hacking;

  const candidates = servers
    .filter(
      (s) =>
        !s.startsWith("hacknet-") &&
        !s.startsWith("pserv-") &&
        s !== "home" &&
        ns.hasRootAccess(s) &&
        ns.getServerMaxMoney(s) > 0 &&
        (ns.getServerRequiredHackingLevel(s) ?? 0) <= playerSkill,
    )
    .sort((a, b) => {
      // Chance & weiche Weaken-Obergrenze einbeziehen
      const scoreA =
        (ns.getServerMaxMoney(a) * ns.hackAnalyzeChance(a)) /
        Math.max(1, ns.getWeakenTime(a));
      const scoreB =
        (ns.getServerMaxMoney(b) * ns.hackAnalyzeChance(b)) /
        Math.max(1, ns.getWeakenTime(b));
      return scoreB - scoreA;
    });

  const bestCandidate = candidates[0] ?? "n00dles";
  // Hysterese-Vergleich bleibt erhalten...
  return bestCandidate;
}
function switchExecutionEngine(
  ns: NS,
  strategy: BatchStrategy,
  target: string | null,
): number {
  switch (strategy) {
    case "BOOTSTRAP":
      return ns.run(PATHS.core.engines.proto, 1, target ?? "n00dles");

    case "XP_GRIND":
      return ns.run(PATHS.core.engines.xpGrind, 1, "joesguns");

    case "PREP":
      return ns.run(PATHS.core.engines.prep, 1, target ?? "n00dles");

    case "SHOTGUN_HWGW":
      return ns.run(PATHS.core.engines.shotgun, 1, target ?? "n00dles");

    case "JIT_HWGW":
      // Der JIT-Batcher wird ohne Ziel-Argument gestartet
      return ns.run(PATHS.core.engines.jitBatcher, 1);

    default:
      return 0;
  }
}

function killAllWorkerPayloads(ns: NS, servers: string[]): void {
  const payloadNames = Object.values(PATHS.payloads).map((p) =>
    p.replace(/^.*[\\/]/, ""),
  );

  for (const server of servers) {
    if (!ns.hasRootAccess(server)) continue;
    for (const proc of ns.ps(server)) {
      if (payloadNames.some((name) => proc.filename.endsWith(name))) {
        ns.kill(proc.pid);
      }
    }
  }
}
