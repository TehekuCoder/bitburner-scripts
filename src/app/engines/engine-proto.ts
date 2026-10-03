import { NS } from "@ns";

import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";

import { PATHS } from "../../infrastructure/runtime/paths.js";
import { EngineMode } from "/shared/types/batcher";
import {
  getAllServers,
  getWorkerFreeRam,
  getWorkerMaxUsableRam,
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
      workerNodes = getAllServers(ns).filter(
        (s) => ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0,
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
    patchBatcherState(ns, {
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
    hackAnalyzeResult > 0 ? Math.floor(0.3 / hackAnalyzeResult) : 10;

  let launchedHack = 0;
  let launchedGrow = 0;
  let launchedWeaken = 0;
  let activeWorkers = 0;

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
      const threads = Math.floor(freeRam / wCost);
      if (threads > 0) {
        const pid = ns.exec(weakenScript, node, threads, target, 0, runId);
        if (pid > 0) {
          launchedWeaken += threads;
          nodeUsed = true;
        }
      }
    } else if (mode === "GROW") {
      let gThreads = Math.floor(
        freeRam /
          (gCost +
            (GROW_SECURITY_PER_THREAD / weakenEffectPerThread) * wCost),
      );
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
          nodeUsed = true;
        } else {
          if (growPid > 0) ns.kill(growPid);
          if (weakenPid > 0) ns.kill(weakenPid);
        }
      }
    } else {
      let hThreads = Math.min(
        Math.floor((freeRam * 0.15) / hCost),
        Math.max(1, maxHackThreads),
      );
      let gThreads = 0;
      let wThreads = 0;
      while (hThreads > 0) {
        const hackSecurity = hThreads * HACK_SECURITY_PER_THREAD;
        const remainingForGrowAndWeaken =
          freeRam - hThreads * hCost -
          getWeakenThreadsForSecurity(hackSecurity, weakenEffectPerThread) *
            wCost;
        gThreads = Math.max(
          0,
          Math.floor(
            remainingForGrowAndWeaken /
              (gCost +
                (GROW_SECURITY_PER_THREAD / weakenEffectPerThread) * wCost),
          ),
        );
        wThreads = getWeakenThreadsForSecurity(
          hackSecurity + gThreads * GROW_SECURITY_PER_THREAD,
          weakenEffectPerThread,
        );
        if (hThreads * hCost + gThreads * gCost + wThreads * wCost <= freeRam) {
          break;
        }
        if (gThreads > 0) gThreads--;
        else hThreads--;
      }

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
