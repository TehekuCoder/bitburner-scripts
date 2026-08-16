import { NS } from "@ns";
import { getAllServers } from "/lib/network.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { patchBatcherState } from "/lib/state.js";
import { PATHS } from "/lib/paths.js";
import { EngineMode } from "/lib/types/batcher";

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

  const hackScript = PATHS.payloads.hack;
  const growScript = PATHS.payloads.grow;
  const weakenScript = PATHS.payloads.weaken;

  let execCounter = 0;
  let lastNetworkScan = 0;
  let workerNodes: string[] = [];
  let currentMode: EngineMode = "UNKNOWN";

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
        (sum, node) => sum + ns.getServerMaxRam(node),
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
      decisionReason = `Geldbestand niedrig (${(moneyRatio * 100).toFixed(1)}% von Max $${ns.format.number(maxMoneyLevel)}). Wachstum priorisiert.`;
    } else {
      newMode = "HARVEST";
      decisionReason = `Ziel optimal konditioniert (Sec: +${secDelta.toFixed(2)}, Money: ${(moneyRatio * 100).toFixed(1)}%). Ernte gestartet.`;
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

    deployProtoWorkers(
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
      execCounter,
    );

    await ns.sleep(2000);
  }
}

function deployProtoWorkers(
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
  execCounter: number,
): void {
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
    if (node !== "home") {
      if (!ns.fileExists(hackScript, node)) ns.scp(hackScript, node, "home");
      if (!ns.fileExists(growScript, node)) ns.scp(growScript, node, "home");
      if (!ns.fileExists(weakenScript, node))
        ns.scp(weakenScript, node, "home");
    }

    const maxRam = ns.getServerMaxRam(node);
    const usedRam = ns.getServerUsedRam(node);
    const reservedRam = node === "home" ? (maxRam <= 32 ? 8 : 16) : 0;
    const freeRam = Math.max(0, maxRam - usedRam - reservedRam);

    if (freeRam < wCost) continue;

    const runId = `${execCounter}_${Math.random().toString(36).substring(2, 7)}`;
    let nodeUsed = false;

    if (mode === "WEAKEN") {
      const threads = Math.floor(freeRam / wCost);
      if (threads > 0) {
        ns.exec(weakenScript, node, threads, target, 0, runId);
        launchedWeaken += threads;
        nodeUsed = true;
      }
    } else if (mode === "GROW") {
      const gThreads = Math.floor((freeRam * 0.8) / gCost);
      const wThreads = Math.floor((freeRam * 0.2) / wCost);

      if (gThreads > 0) ns.exec(growScript, node, gThreads, target, 0, runId);
      if (wThreads > 0) ns.exec(weakenScript, node, wThreads, target, 0, runId);

      launchedGrow += gThreads;
      launchedWeaken += wThreads;
      if (gThreads > 0 || wThreads > 0) nodeUsed = true;
    } else {
      let hThreads = Math.floor((freeRam * 0.15) / hCost);
      hThreads = Math.min(hThreads, Math.max(1, maxHackThreads));

      const ramForHG = freeRam - hThreads * hCost;
      const gThreads = Math.floor((ramForHG * 0.7) / gCost);
      const wThreads = Math.floor((ramForHG * 0.3) / wCost);

      if (hThreads > 0) ns.exec(hackScript, node, hThreads, target, 0, runId);
      if (gThreads > 0) ns.exec(growScript, node, gThreads, target, 0, runId);
      if (wThreads > 0) ns.exec(weakenScript, node, wThreads, target, 0, runId);

      launchedHack += hThreads;
      launchedGrow += gThreads;
      launchedWeaken += wThreads;
      if (hThreads > 0 || gThreads > 0 || wThreads > 0) nodeUsed = true;
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
