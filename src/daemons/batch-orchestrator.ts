import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { getAllServers, getNetworkMaxRam } from "/lib/network.js";
import { patchState } from "/lib/state.js";
import { BatchStrategy } from "/lib/types/batcher.js";
import { PATHS } from "/lib/paths.js";
import { loadBnMults } from "/lib/utils";

interface StrategyEvaluation {
  strategy: BatchStrategy;
  target: string | null;
  strategyReason: string;
  targetReason: string;
  topCandidatesStr: string;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Orchestrator");

  const JIT_DASHBOARD = "core/sys-jit-batcher-dashboard.js";
  const ENGINE_DASHBOARD = "core/sys-engine-dashboard.js";

  let activeStrategy: BatchStrategy | null = null;
  let activeTarget: string | null = null;
  let activeProcessId = 0;

  stopAllEngines(ns);

  const bnMults = loadBnMults(ns);
  logger.info("🚀 Batch-Orchestrator gestartet.", undefined, {
    tags: ["init"],
  });

  while (true) {
    const servers = getAllServers(ns);
    const totalMaxRam = getNetworkMaxRam(ns, servers);

    // 1. Strategie & Target evaluieren
    const evalResult = evaluateStrategyAndTarget(
      ns,
      servers,
      totalMaxRam,
      activeStrategy,
      activeTarget,
      bnMults,
      logger,
    );

    const {
      strategy: desiredStrategy,
      target,
      strategyReason,
      targetReason,
      topCandidatesStr,
    } = evalResult;

    // 2. Wechsel-Bedingungen prüfen
    const strategyChanged = desiredStrategy !== activeStrategy;

    // Bei JIT_HWGW steuert der Daemon die Ziele selbst -> Zielwechsel ignorieren
    const targetChanged =
      desiredStrategy !== "JIT_HWGW" && target !== activeTarget;

    const processDied = activeProcessId > 0 && !ns.isRunning(activeProcessId);

    if (strategyChanged || targetChanged || processDied) {
      const changeType = processDied
        ? "PROCESS_DIED"
        : strategyChanged
          ? "STRATEGY_CHANGE"
          : "TARGET_CHANGE";

      logger.info(
        `🔄 Statuswechsel [${changeType}]: Strategie [${activeStrategy ?? "NONE"} ➡️ ${desiredStrategy}] | Ziel [${activeTarget ?? "MULTI"} ➡️ ${target ?? "MULTI"}]`,
        target ?? undefined,
        {
          context: {
            previousStrategy: activeStrategy ?? "NONE",
            newStrategy: desiredStrategy,
            previousTarget: activeTarget ?? "MULTI",
            newTarget: target ?? "MULTI",
            strategyReason,
            targetReason,
            topCandidates: topCandidatesStr,
            totalNetworkRam: totalMaxRam,
          },
          tags: ["state-change", desiredStrategy.toLowerCase()],
        },
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
          target ?? undefined,
          { context: { strategy: desiredStrategy, target: target ?? "NONE" } },
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
        : activeStrategy === "BOOTSTRAP" ||
            activeStrategy === "PREP" ||
            activeStrategy === "SHOTGUN_HWGW" ||
            activeStrategy === "XP_GRIND"
          ? ENGINE_DASHBOARD
          : null;

    const knownDashboards = [JIT_DASHBOARD, ENGINE_DASHBOARD];

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
            logger.info(`📊 Dashboard gestartet: ${dashScript}`, undefined, {
              tags: ["dashboard"],
            });
          }
        }
      } else {
        if (ns.isRunning(dashScript, "home")) {
          ns.scriptKill(dashScript, "home");
          logger.info(`⏹️ Dashboard beendet: ${dashScript}`, undefined, {
            tags: ["dashboard"],
          });
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
  logger: Logger,
): StrategyEvaluation {
  const hackingEfficiency =
    (bnMults.ServerMaxMoney ?? 1.0) * (bnMults.ScriptHackMoneyGain ?? 1.0);
  const playerSkill = ns.getPlayer().skills.hacking;

  // 1️⃣ XP-GRIND Check
  if (hackingEfficiency === 0 || playerSkill < 30) {
    return {
      strategy: "XP_GRIND",
      target: "joesguns",
      strategyReason: `Hacking-Skill zu niedrig (${playerSkill} < 30) oder BitNode-Effizienz ist 0. XP-Grind auf joesguns priorisiert.`,
      targetReason: "Fester XP-Grind-Server (joesguns).",
      topCandidatesStr: "joesguns (XP)",
    };
  }

  const homeRam = ns.getServerMaxRam("home");
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  // 2️⃣ JIT_HWGW: Ab 512 GB home-RAM + Formulas (Autonomes Multi-Targeting)
  if (homeRam >= 512 && hasFormulas) {
    return {
      strategy: "JIT_HWGW",
      target: null,
      strategyReason: `High-End Setup erkannt (Home-RAM: ${homeRam} GB >= 512 GB & Formulas.exe vorhanden). Autonomes Multi-Targeting gestartet.`,
      targetReason: "Multi-Targeting wird intern vom JIT-Batcher verwaltet.",
      topCandidatesStr: "JIT-Multi-Targeting",
    };
  }

  // Bestes Ziel evaluieren
  const targetEval = selectBestTarget(ns, servers, currentTarget, logger);
  const bestTarget = targetEval.target;

  // 3️⃣ BOOTSTRAP / PROTO: home < 256 GB RAM
  if (homeRam < 256) {
    return {
      strategy: "BOOTSTRAP",
      target: bestTarget,
      strategyReason: `Geringer Home-RAM (${homeRam} GB < 256 GB). Bootstrap Proto-Engine aktiv für schnellen Cashflow.`,
      targetReason: targetEval.reason,
      topCandidatesStr: targetEval.topCandidatesStr,
    };
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
      return {
        strategy: "SHOTGUN_HWGW",
        target,
        strategyReason: `Bestehender Shotgun-Zyklus auf '${target}' fortgesetzt (Money: ${((currentMoney / maxMoney) * 100).toFixed(0)}%, Sec: +${(currentDiff - minDiff).toFixed(1)}).`,
        targetReason: targetEval.reason,
        topCandidatesStr: targetEval.topCandidatesStr,
      };
    }
  }

  const isPrepped =
    currentDiff - minDiff <= 0.05 &&
    (maxMoney > 0 ? currentMoney / maxMoney >= 0.98 : true);

  if (!isPrepped) {
    return {
      strategy: "PREP",
      target,
      strategyReason: `Ziel '${target}' muss konditioniert werden (Money: ${((currentMoney / maxMoney) * 100).toFixed(1)}% / 98%, Sec: +${(currentDiff - minDiff).toFixed(2)} / <=0.05).`,
      targetReason: targetEval.reason,
      topCandidatesStr: targetEval.topCandidatesStr,
    };
  }

  return {
    strategy: "SHOTGUN_HWGW",
    target,
    strategyReason: `Ziel '${target}' ist vollständig präpariert. Starte Shotgun HWGW Batching.`,
    targetReason: targetEval.reason,
    topCandidatesStr: targetEval.topCandidatesStr,
  };
}

function selectBestTarget(
  ns: NS,
  servers: string[],
  currentTarget: string | null,
  logger: Logger,
): { target: string; reason: string; topCandidatesStr: string } {
  const playerSkill = ns.getPlayer().skills.hacking;
  const hasFormulas = ns.fileExists("Formulas.exe", "home");
  const player = ns.getPlayer();

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
    .map((s) => {
      const serverObj = ns.getServer(s);
      const maxMoney = serverObj.moneyMax ?? 0;
      const curMoney = serverObj.moneyAvailable ?? 0;
      const curSec = serverObj.hackDifficulty ?? 100;
      const minSec = serverObj.minDifficulty ?? 10;

      let score = 0;
      let estChance = 0;
      let minSecWeakenTime = 0;
      let prepTimeMs = 0;

      if (hasFormulas) {
        // 1. Mit Formulas.exe: Exakte Potenzial-Berechnung bei MIN-Security & MAX-Money
        const mockMinServer = {
          ...serverObj,
          hackDifficulty: minSec,
          moneyAvailable: maxMoney,
        };
        estChance = ns.formulas.hacking.hackChance(mockMinServer, player);
        minSecWeakenTime = ns.formulas.hacking.weakenTime(
          mockMinServer,
          player,
        );

        // PREP-Zeit schätzen
        const secDelta = Math.max(0, curSec - minSec);
        const moneyRatio =
          maxMoney > 0 ? Math.max(0.001, curMoney / maxMoney) : 1;

        if (secDelta > 0.05 || moneyRatio < 0.98) {
          const currentWeakenTime = ns.formulas.hacking.weakenTime(
            serverObj,
            player,
          );
          const secCycles = secDelta > 0.05 ? Math.ceil(secDelta / 5) : 0;
          const growCycles =
            moneyRatio < 0.98 ? Math.ceil(Math.log2(1 / moneyRatio)) : 0;

          prepTimeMs = (secCycles + growCycles) * currentWeakenTime;
        }
      } else {
        // 2. Ohne Formulas.exe (BN9 Fallback): Spiel-Mechanik nachbilden
        const reqHacking = Math.max(1, serverObj.requiredHackingSkill ?? 1);

        const currentWeakenTime = ns.getWeakenTime(s);
        minSecWeakenTime = currentWeakenTime * ((minSec + 50) / (curSec + 50));

        const skillMult = Math.max(
          0,
          (1.75 * playerSkill - reqHacking) / (1.75 * playerSkill),
        );
        const secMult = (100 - minSec) / 100;
        estChance = Math.min(1.0, Math.max(0.01, skillMult * secMult));

        // PREP-Zeit schätzen
        const secDelta = Math.max(0, curSec - minSec);
        const moneyRatio =
          maxMoney > 0 ? Math.max(0.001, curMoney / maxMoney) : 1;

        if (secDelta > 0.05 || moneyRatio < 0.98) {
          const secCycles = secDelta > 0.05 ? Math.ceil(secDelta / 5) : 0;
          const growCycles =
            moneyRatio < 0.98 ? Math.ceil(Math.log2(1 / moneyRatio)) : 0;

          prepTimeMs = (secCycles + growCycles) * currentWeakenTime;
        }
      }

      // PREP-Strafe: Amortisation der Aufwärmzeit über einen Horizont von 50 Batch-Zyklen
      const AMORTIZATION_CYCLES = 50;
      const effectiveCycleTimeMs =
        minSecWeakenTime + prepTimeMs / AMORTIZATION_CYCLES;

      score = (maxMoney * estChance) / Math.max(1, effectiveCycleTimeMs);

      return {
        server: s,
        score,
        maxMoney,
        chance: estChance,
        weakenTime: minSecWeakenTime,
        prepTimeMs,
      };
    })
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return {
      target: "n00dles",
      reason: "Keine gehackten Server mit Geld gefunden. Fallback auf n00dles.",
      topCandidatesStr: "n00dles (Fallback)",
    };
  }

  const topCandidatesStr = candidates
    .slice(0, 3)
    .map(
      (c) =>
        `${c.server} (Score: ${ns.format.number(c.score)}, Max$: $${ns.format.number(c.maxMoney)}${c.prepTimeMs > 0 ? `, Prep: ${(c.prepTimeMs / 1000).toFixed(0)}s` : ""})`,
    )
    .join(" | ");

  const topCandidate = candidates[0];

  // Hysterese-Prüfung: Bleibe beim aktuellen Ziel, falls dessen Score >= 80% des Top-Kandidaten entspricht
  if (currentTarget && currentTarget !== topCandidate.server) {
    const currentObj = candidates.find((c) => c.server === currentTarget);
    if (currentObj && currentObj.score >= topCandidate.score * 0.8) {
      const reason = `Hysterese aktiv: Aktuelles Ziel '${currentTarget}' beibehalten (Score: ${ns.format.number(currentObj.score)} >= 80% von '${topCandidate.server}': ${ns.format.number(topCandidate.score)}). Target-Swapping vermieden.`;

      logger.debug(reason, currentTarget, {
        context: {
          currentTarget,
          currentScore: Math.round(currentObj.score),
          topCandidate: topCandidate.server,
          topScore: Math.round(topCandidate.score),
        },
        tags: ["target-hysteresis"],
      });

      return {
        target: currentTarget,
        reason,
        topCandidatesStr,
      };
    }
  }

  const calculationMethod = hasFormulas ? "Formulas.exe" : "Estimation-Formula";
  const prepInfo =
    topCandidate.prepTimeMs > 0
      ? `, EstPrepTime: ${(topCandidate.prepTimeMs / 1000).toFixed(1)}s`
      : "";
  const reason = `Server '${topCandidate.server}' hat den höchsten Ertrags-Score (${ns.format.number(topCandidate.score)}) via ${calculationMethod} [MaxMoney: $${ns.format.number(topCandidate.maxMoney)}, Chance: ${(topCandidate.chance * 100).toFixed(0)}%, MinSecWeaken: ${(topCandidate.weakenTime / 1000).toFixed(1)}s${prepInfo}].`;

  logger.debug(
    `🎯 Ziel-Analyse abgeschlossen: '${topCandidate.server}' gewählt.`,
    topCandidate.server,
    {
      context: {
        target: topCandidate.server,
        score: Math.round(topCandidate.score),
        maxMoney: topCandidate.maxMoney,
        chanceRatio: Math.round(topCandidate.chance * 100) / 100,
        weakenTimeSec: Math.round((topCandidate.weakenTime / 1000) * 10) / 10,
        prepTimeSec: Math.round((topCandidate.prepTimeMs / 1000) * 10) / 10,
        hasFormulas,
      },
      tags: ["target-selection"],
    },
  );

  return {
    target: topCandidate.server,
    reason,
    topCandidatesStr,
  };
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
