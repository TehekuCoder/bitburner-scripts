import { NS } from "@ns";

import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";

import { PATHS } from "../../infrastructure/runtime/paths.js";
import { EngineMode } from "/shared/types/batcher";
import {
  getAllServers,
  getWorkerFreeRam,
  getWorkerMaxUsableRam,
  prioritizeHackingWorkers,
} from "/infrastructure/network/network.js";
import { patchBatcherState } from "/infrastructure/state/state.js";
import { formatPercent, loadBnMults } from "/lib/utils.js";
import {
  GROW_SECURITY_PER_THREAD,
  HACK_SECURITY_PER_THREAD,
  getWeakenEffectPerThread,
  getWeakenThreadsForSecurity,
} from "/domain/hacking/weaken.js";
import { ensureScriptsOnServer } from "/domain/hacking/provision.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const target = (ns.args[0] as string) || "joesguns";
  const logger = new Logger(ns, "ProtoEngine", target, "DEBUG", undefined, {
    engine: "proto",
  });

  if (!ns.serverExists(target)) {
    logger.error(
      `Ziel-Server '${target}' existiert nicht. Engine wird beendet.`,
      target,
      {
        tags: ["target-error"],
      },
    );
    return;
  }

  // --- Ziel-Analyse & Auswahlbegründung ---
  const playerHackLevel = ns.getHackingLevel();
  const reqHackLevel = ns.getServerRequiredHackingLevel(target);
  const maxMoney = ns.getServerMaxMoney(target);
  const minSec = ns.getServerMinSecurityLevel(target);
  const hasRoot = ns.hasRootAccess(target);

  const selectionReason = ns.args[0]
    ? `Manuell via CLI übergeben: '${target}'`
    : `Default-Fallback für Early Cashflow ('joesguns')`;

  logger.info(`⚡ Proto-Engine gestartet für [${target}]`, target, {
    context: {
      selectionReason,
      reqHackLevel,
      playerHackLevel,
      maxMoney,
      minSec,
      hasRoot,
    },
    tags: ["init", "target-analysis"],
  });

  if (playerHackLevel < reqHackLevel) {
    logger.warn(
      `Hacking-Level unter Anforderung (${playerHackLevel}/${reqHackLevel}). Angriffe auf ${target} könnten fehlschlagen!`,
      target,
      { context: { playerHackLevel, reqHackLevel } },
    );
  }

  const hackScript = PATHS.services.payloads.hack;
  const growScript = PATHS.services.payloads.grow;
  const weakenScript = PATHS.services.payloads.weaken;

  let execCounter = 0;
  let lastNetworkScan = 0;
  let workerNodes: string[] = [];
  let currentMode: EngineMode = "UNKNOWN";
  const weakenEffectPerThread = getWeakenEffectPerThread(
    loadBnMults(ns).ServerWeakenRate,
  );
  if (weakenEffectPerThread <= 0) {
    logger.error("ServerWeakenRate ist 0; Proto kann Security nicht ausgleichen.");
    return;
  }

  while (true) {
    if (!ns.serverExists(target)) {
      logger.error(`Ziel-Server '${target}' verloren. Beende Engine.`, target);
      return;
    }

    const now = Date.now();
    // Netz-Infektion und Server-List-Update alle 15 Sekunden
    if (now - lastNetworkScan > 15_000 || workerNodes.length === 0) {
      workerNodes = prioritizeHackingWorkers(ns, getAllServers(ns)).filter(
        (s) => ns.getServerMaxRam(s) > 0,
      );
      const scanDuration = logger.timeEnd("network-scan", "DEBUG", target);

      const totalRam = workerNodes.reduce(
        (sum, node) => sum + getWorkerMaxUsableRam(ns, node, "hacking"),
        0,
      );
      logger.debug(
        `Netzwerk aktualisiert: ${workerNodes.length} Worker-Knoten bereit (${totalRam} GB RAM).`,
        target,
        {
          context: {
            workerCount: workerNodes.length,
            totalRam,
            scanMs: scanDuration,
          },
          tags: ["network-scan"],
        },
      );
      lastNetworkScan = now;
    }

    const curSec = ns.getServerSecurityLevel(target);
    const minSecLevel = ns.getServerMinSecurityLevel(target);
    const curMoney = ns.getServerMoneyAvailable(target);
    const maxMoneyLevel = ns.getServerMaxMoney(target);

    const secDelta = curSec - minSecLevel;
    const moneyRatio = maxMoneyLevel > 0 ? curMoney / maxMoneyLevel : 1;

    // Modus-Bestimmung & Transparenz der Entscheidungslogik
    let newMode: EngineMode = "HARVEST";
    let decisionReason = "";

    if (secDelta > 2.0) {
      newMode = "WEAKEN";
      decisionReason = `Sicherheit zu hoch (+${secDelta.toFixed(2)} über Min-Sec ${minSecLevel}). Schwächung priorisiert.`;
    } else if (moneyRatio < 0.7) {
      newMode = "GROW";
      decisionReason = `Geldbestand niedrig (${formatPercent(moneyRatio, undefined, 1)} von Max $${ns.format.number(maxMoneyLevel)}). Wachstum priorisiert.`;
    } else {
      newMode = "HARVEST";
      decisionReason = `Ziel optimal konditioniert (Sec: +${secDelta.toFixed(2)}, Money: ${formatPercent(moneyRatio, undefined, 1)}). Ernte gestartet.`;
    }

    // Protokollierung bei Zustandswechsel
    if (newMode !== currentMode) {
      logger.info(
        `🔄 Ziel-Modus gewechselt: [${currentMode}] -> [${newMode}]`,
        target,
        {
          context: {
            previousMode: currentMode,
            newMode,
            secDelta: Math.round(secDelta * 100) / 100,
            moneyRatio: Math.round(moneyRatio * 100) / 100,
            reason: decisionReason,
          },
          tags: ["state-change"],
        },
      );
      currentMode = newMode;
    }

    // In engine-proto.ts beim Start/Loop:
    await patchBatcherState(ns, {
      batchStrategy: "PROTO_BATCH",
      batcherActive: true,
      batcherTarget: target,
      batcherProgress: `PROTO-RUNNING (${target})`,
    });

    execCounter = (execCounter + 1) % 10000;

    await deployProtoWorkers(
      ns,
      logger,
      workerNodes,
      target,
      newMode,
      secDelta,
      moneyRatio,
      hackScript,
      growScript,
      weakenScript,
      weakenEffectPerThread,
      execCounter,
    );

    await ns.sleep(2000);
  }
}

async function deployProtoWorkers(
  ns: NS,
  logger: Logger,
  workerNodes: string[],
  target: string,
  mode: EngineMode,
  secDelta: number,
  moneyRatio: number,
  hackScript: string,
  growScript: string,
  weakenScript: string,
  weakenEffectPerThread: number,
  execCounter: number,
): Promise<void> {
  const hCost = ns.getScriptRam(hackScript, "home");
  const gCost = ns.getScriptRam(growScript, "home");
  const wCost = ns.getScriptRam(weakenScript, "home");

  const hackAnalyzeResult = ns.hackAnalyze(target);
  const maxHackThreads =
    hackAnalyzeResult > 0 ? Math.max(1, Math.floor(0.1 / hackAnalyzeResult)) : 1;
  let remainingHackThreads = mode === "HARVEST" ? maxHackThreads : 0;
  const analyzedGrowThreads =
    mode === "GROW" && moneyRatio > 0
      ? ns.growthAnalyze(target, 1 / moneyRatio)
      : Number.POSITIVE_INFINITY;
  let remainingGrowThreads =
    mode === "GROW"
      ? Number.isFinite(analyzedGrowThreads)
        ? Math.max(1, Math.ceil(analyzedGrowThreads))
        : Number.MAX_SAFE_INTEGER
      : 0;
  let remainingWeakenThreads =
    mode === "WEAKEN"
      ? getWeakenThreadsForSecurity(
          Math.max(0, secDelta - 0.5),
          weakenEffectPerThread,
        )
      : 0;
  const hackPercent = Math.min(0.99, Math.max(0, hackAnalyzeResult));
  const analyzedGrowPerHack =
    hackPercent > 0 && hackPercent < 1
      ? ns.growthAnalyze(target, 1 / (1 - hackPercent))
      : 0;
  const growThreadsPerHack =
    Number.isFinite(analyzedGrowPerHack) && analyzedGrowPerHack > 0
      ? Math.ceil(analyzedGrowPerHack)
      : 0;

  let launchedHack = 0;
  let launchedGrow = 0;
  let launchedWeaken = 0;
  let activeWorkers = 0;

  const scriptNames = [hackScript, growScript, weakenScript].map((script) =>
    script.replace(/^.*[\\/]/, ""),
  );
  const inFlight = workerNodes.flatMap((node) =>
    ns.ps(node).filter(
      (proc) =>
        proc.args[0] === target &&
        scriptNames.some((name) => proc.filename.endsWith(name)),
    ),
  );
  if (inFlight.length > 0) {
    logger.debug(
      `Warte auf laufende ${target}-Aktionen (H:${inFlight.filter((p) => p.filename.endsWith(scriptNames[0])).reduce((sum, p) => sum + p.threads, 0)} G:${inFlight.filter((p) => p.filename.endsWith(scriptNames[1])).reduce((sum, p) => sum + p.threads, 0)} W:${inFlight.filter((p) => p.filename.endsWith(scriptNames[2])).reduce((sum, p) => sum + p.threads, 0)} Threads).`,
      target,
    );
    return;
  }

  for (const node of workerNodes) {
    if (
      !(await ensureScriptsOnServer(ns, node, [
        hackScript,
        growScript,
        weakenScript,
      ]))
    ) {
      continue;
    }

    const freeRam = getWorkerFreeRam(ns, node);

    if (freeRam < wCost) continue;

    const runId = `${execCounter}_${Math.random().toString(36).substring(2, 7)}`;
    let nodeUsed = false;

    if (mode === "WEAKEN") {
      const threads = Math.min(
        Math.floor(freeRam / wCost),
        remainingWeakenThreads,
      );
      if (threads > 0) {
        const pid = ns.exec(weakenScript, node, threads, target, 0, runId);
        if (pid > 0) {
          launchedWeaken += threads;
          remainingWeakenThreads -= threads;
          nodeUsed = true;
        }
      }
    } else if (mode === "GROW") {
      let gThreads = Math.floor(
        freeRam /
          (gCost +
            (GROW_SECURITY_PER_THREAD / weakenEffectPerThread) * wCost),
      );
      gThreads = Math.min(gThreads, remainingGrowThreads);
      let wThreads = getWeakenThreadsForSecurity(
        gThreads * GROW_SECURITY_PER_THREAD,
        weakenEffectPerThread,
      );
      while (gThreads > 0 && gThreads * gCost + wThreads * wCost > freeRam) {
        gThreads--;
        wThreads = getWeakenThreadsForSecurity(
          gThreads * GROW_SECURITY_PER_THREAD,
          weakenEffectPerThread,
        );
      }

      if (gThreads > 0) {
        const growPid = ns.exec(growScript, node, gThreads, target, 0, runId);
        const weakenPid =
          wThreads > 0
            ? ns.exec(weakenScript, node, wThreads, target, 0, runId)
            : 0;
        if (growPid > 0 && (wThreads === 0 || weakenPid > 0)) {
          launchedGrow += gThreads;
          launchedWeaken += wThreads;
          remainingGrowThreads -= gThreads;
          nodeUsed = true;
        } else {
          if (growPid > 0) ns.kill(growPid);
          if (weakenPid > 0) ns.kill(weakenPid);
        }
      }
    } else {
      const weakenPerHackUnit = getWeakenThreadsForSecurity(
        HACK_SECURITY_PER_THREAD +
          growThreadsPerHack * GROW_SECURITY_PER_THREAD,
        weakenEffectPerThread,
      );
      const unitRam =
        hCost + growThreadsPerHack * gCost + weakenPerHackUnit * wCost;
      const hThreads =
        growThreadsPerHack > 0 && Number.isFinite(unitRam) && unitRam > 0
          ? Math.min(remainingHackThreads, Math.floor(freeRam / unitRam))
          : 0;
      const gThreads = hThreads * growThreadsPerHack;
      const wThreads = hThreads * weakenPerHackUnit;

      const pids: number[] = [];
      if (hThreads > 0) {
        pids.push(ns.exec(hackScript, node, hThreads, target, 0, runId));
      }
      if (gThreads > 0) {
        pids.push(ns.exec(growScript, node, gThreads, target, 0, runId));
      }
      if (wThreads > 0) {
        pids.push(ns.exec(weakenScript, node, wThreads, target, 0, runId));
      }
      if (pids.length > 0 && pids.every((pid) => pid > 0)) {
        launchedHack += hThreads;
        launchedGrow += gThreads;
        launchedWeaken += wThreads;
        remainingHackThreads -= hThreads;
        nodeUsed = true;
      } else {
        for (const pid of pids) {
          if (pid > 0) ns.kill(pid);
        }
      }
    }

    if (nodeUsed) activeWorkers++;
  }

  logger.debug(`Dispatch ausgeführt [${mode}]`, target, {
    context: {
      mode,
      activeWorkers,
      hackThreads: launchedHack,
      growThreads: launchedGrow,
      weakenThreads: launchedWeaken,
      secDelta: Math.round(secDelta * 100) / 100,
      moneyRatio: Math.round(moneyRatio * 100) / 100,
    },
    tags: ["dispatch", mode.toLowerCase()],
  });
}
