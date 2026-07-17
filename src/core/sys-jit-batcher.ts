import { NS } from "@ns";
import { getAllServers } from "../lib/network.js";
import { patchState, loadState } from "./state-manager.js";
import { loadBnMults } from "../lib/state.js";
import { Logger } from "./logger.js";
import { JitEvent, WorkerNode } from "core/types";
import { calculateBatch, BatchPlan } from "../utils/batch-calculator.js";

// Konfigurationen
const SPACER = 80;
const BATCH_GAP = 4 * SPACER;
const HOME_RAM_RESERVE = 64;
const SCRIPT_RAM_BASE = 1.75;
const DYNAMIC_MAX_WEAKEN_TIME = 60 * 60 * 1000; // 60 Minuten

// Skript-Pfade
const PATH_HACK = "/tasks/hack.js";
const PATH_GROW = "/tasks/grow.js";
const PATH_WEAKEN = "/tasks/weaken.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();

  const logger = new Logger(
    ns,
    "JIT-Batcher",
    "DEBUG",
    "/logs/sys-jit-batcher.txt",
  );
  const bnMults = loadBnMults(ns);

  logger.info("⚡ JIT-Zündung sequenziert. Melde Spur im State-Manager an...");

  patchState(ns, {
    batcherActive: true,
    batcherProgress: "Initialisiere Netzwerk-Pool...",
    batcherTarget: "Suche...",
    batcherPlan: null,
  });

  const servers = getAllServers(ns);
  for (const s of servers) {
    if (s !== "home" && ns.hasRootAccess(s)) {
      // 1. Alte Prozesse stoppen
      ns.killall(s, true);

      // 2. Frische JIT-Skripte von 'home' auf den Server schieben
      ns.scp([PATH_HACK, PATH_GROW, PATH_WEAKEN], s, "home");
    }
  }

  const eventQueue: JitEvent[] = [];
  let nextAvailableLandTime = 0;
  let batchIdCounter = 0;

  let target: string | null = null;
  let dynamicMaxBatchesForTarget = 100;
  let batchesSentForTarget = 0;
  let lastStateUpdate = 0;
  let activePlan: BatchPlan | null = null;

  logger.success(
    "🚀 Autarke JIT-Engine läuft ohne externe Planer-Abhängigkeit.",
  );

  while (true) {
    const now = Date.now();
    // ⚡ Optimierung: Übergebe das bestehende 'servers'-Array, statt neu zu scannen
    const netRam = getNetworkRamMetrics(ns, servers);
    const virtualFreeRam = getVirtualFreeRam(
      ns,
      netRam.totalMaxRam,
      eventQueue,
    );

    // -------------------------------------------------------------------------
    // 🎯 INTERNES TARGETING & REPLANNING (Früher utils/batch-planner.ts)
    // -------------------------------------------------------------------------
    if (
      !target ||
      batchesSentForTarget >= dynamicMaxBatchesForTarget ||
      eventQueue.length === 0
    ) {
      logger.info(
        "🔍 Pipeline leer oder Target-Limit erreicht. Berechne optimales Ziel...",
      );
      patchState(ns, { batcherProgress: "Berechne optimales Ziel..." });

      // Rufe die ehemals externe Logik direkt im Speicher auf
      const planning = internalPlanner(
        ns,
        servers,
        netRam.totalMaxRam,
        virtualFreeRam,
        bnMults,
      );

      if (planning && planning.target !== target) {
        logger.warn(
          `🎯 Target-Wechsel: ${target} ➡️ ${planning.target}. Bereinige Queue.`,
        );
        eventQueue.length = 0;
        nextAvailableLandTime = 0;
        batchesSentForTarget = 0;
        target = planning.target;
        activePlan = planning.plan;
        dynamicMaxBatchesForTarget = planning.maxBatches;
      } else if (planning) {
        // Gleiches Ziel, aber Pipeline wird für eine neue Runde aufgefrischt
        activePlan = planning.plan;
        dynamicMaxBatchesForTarget = planning.maxBatches;
        batchesSentForTarget = 0;
      }

      if (!target || !activePlan) {
        logger.warn(
          "⚠️ Kein valide hackbares Ziel mit ausreichend freiem RAM gefunden. Schlafe...",
        );
        patchState(ns, { batcherProgress: "Kein RAM-Slot frei" });
        await ns.sleep(5000);
        continue;
      }
    }

    // -------------------------------------------------------------------------
    // 1. NEUE WELLEN IN DIE QUEUE PLANEN (ZUKUNFTS-SCHLEIFE)
    // -------------------------------------------------------------------------
    if (
      target &&
      activePlan &&
      batchesSentForTarget < dynamicMaxBatchesForTarget
    ) {
      if (virtualFreeRam >= activePlan.totalRam) {
        if (nextAvailableLandTime < now + activePlan.weakenTime + 500) {
          nextAvailableLandTime = now + activePlan.weakenTime + 500;
        }

        const bId = batchIdCounter++;
        const tLand = nextAvailableLandTime;

        const landH = tLand - SPACER;
        const landW1 = tLand;
        const landG = tLand + SPACER;
        const landW2 = tLand + 2 * SPACER;

        const startH = landH - activePlan.hackTime;
        const startW1 = landW1 - activePlan.weakenTime;
        const startG = landG - activePlan.growTime;
        const startW2 = landW2 - activePlan.weakenTime;

        // 🟢 BUG-FIX: Nur noch EIN Array definieren, direkt filtern und EINMAL pushen
        const validEvents = [
          {
            id: `b${bId}-h`,
            batchId: bId,
            script: PATH_HACK,
            threads: activePlan.hackThreads,
            target,
            startTime: startH,
            landTime: landH,
          },
          {
            id: `b${bId}-w1`,
            batchId: bId,
            script: PATH_WEAKEN,
            threads: activePlan.weaken1Threads,
            target,
            startTime: startW1,
            landTime: landW1,
          },
          {
            id: `b${bId}-g`,
            batchId: bId,
            script: PATH_GROW,
            threads: activePlan.growThreads,
            target,
            startTime: startG,
            landTime: landG,
          },
          {
            id: `b${bId}-w2`,
            batchId: bId,
            script: PATH_WEAKEN,
            threads: activePlan.weaken2Threads,
            target,
            startTime: startW2,
            landTime: landW2,
          },
        ].filter((ev) => ev.threads > 0);

        eventQueue.push(...validEvents);
        eventQueue.sort((a, b) => a.startTime - b.startTime);

        batchesSentForTarget++;
        nextAvailableLandTime += BATCH_GAP;

        patchState(ns, {
          batcherPlan: activePlan,
          batcherTarget: target,
          batcherDynamicMaxBatches: dynamicMaxBatchesForTarget,
          batcherProgress: `Pipelines gefüllt (${batchesSentForTarget}/${dynamicMaxBatchesForTarget})`,
        });
      } else {
        patchState(ns, {
          batcherProgress: `Sättigung erreicht | Queue: ${eventQueue.length} Events`,
        });
      }
    }

    // -------------------------------------------------------------------------
    // 2. TIMING-TICKER: SKRIPTE JUST-IN-TIME ABSCHIEẞEN
    // -------------------------------------------------------------------------
    while (eventQueue.length > 0 && Date.now() >= eventQueue[0].startTime) {
      const event = eventQueue.shift()!;

      if (Date.now() - event.startTime > 30) {
        logger.warn(
          `⏳ Event ${event.id} um ${Date.now() - event.startTime}ms verzögert! Drop zur Desync-Vermeidung.`,
        );
        continue;
      }

      // ⚡ Optimierung: Auch hier die gecashten Server nutzen
      const workers = getAvailableWorkers(ns, servers);
      const dispatched = executeOnWorkers(ns, event, workers);

      if (!dispatched) {
        logger.error(
          `🛑 JIT-Kollaps! Realer RAM-Mangel bei ${event.id}. Breche Pipeline ab.`,
        );
        eventQueue.length = 0;
        target = null;
        break;
      }
    }

    if (now - lastStateUpdate > 1000) {
      patchState(ns, {
        batcherProgress: `Executing JIT | Queue: ${eventQueue.length} Events`,
        batcherRamNeeded: Math.max(0, netRam.totalMaxRam - virtualFreeRam),
      });
      lastStateUpdate = now;
    }

    await ns.sleep(15);
  }
}


function internalPlanner(
  ns: NS,
  servers: string[],
  totalUsableMaxRam: number,
  currentFreeRamPool: number,
  bnMults: any,
): { target: string; plan: BatchPlan; maxBatches: number } | null {
  const currentState = loadState(ns);
  const shareBufferPercent =
    currentState?.fillerConfig?.shareMaxRamPercent || 0.0;
  const playerHackLevel = ns.getHackingLevel();

  // Filter gültige Ziele heraus
  const targets = servers.filter(
    (s) =>
      ns.hasRootAccess(s) &&
      ns.getServerMaxMoney(s) > 0 &&
      ns.getServerRequiredHackingLevel(s) <= playerHackLevel,
  );

  let bestTarget: string | null = null;
  let highestScore = 0;
  let optimalPlan: BatchPlan | null = null;

  if (currentFreeRamPool <= 0) return null;

  for (const s of targets) {
    const startGreed = currentFreeRamPool < 256 ? 0.01 : 0.1;
    let testPlan: BatchPlan | null = null;

    for (let greed = startGreed; greed <= 0.95; greed += 0.05) {
      testPlan = calculateBatch(
        ns,
        s,
        bnMults,
        greed,
        SPACER,
      ) as BatchPlan | null;
      if (testPlan !== null) break;
    }

    if (!testPlan || testPlan.totalRam > currentFreeRamPool) continue;

    const idealExecutionTime = testPlan.executionTime;
    if (idealExecutionTime > DYNAMIC_MAX_WEAKEN_TIME) continue;

    const score = ns.getServerMaxMoney(s) / idealExecutionTime;

    if (score > highestScore) {
      highestScore = score;
      bestTarget = s;
    }
  }

  if (!bestTarget) return null;

  // Perfekten, optimierten Plan für das gewählte Ziel schmieden (Greed-Schleife)
  const serverMock = ns.getServer(bestTarget);
  serverMock.hackDifficulty = serverMock.minDifficulty;
  const weakenTime = ns.formulas!.hacking.weakenTime(
    serverMock,
    ns.getPlayer(),
  );

  const maxConcurrentBatches = Math.max(1, Math.floor(weakenTime / SPACER));
  const idealBatchRam = totalUsableMaxRam / maxConcurrentBatches;

  let largestSingleServerRam = totalUsableMaxRam; // Fallback
  if (servers.length > 0) {
    largestSingleServerRam = ns.getServerMaxRam(servers[0]);
    if (servers[0] === "home")
      largestSingleServerRam = Math.max(
        0,
        largestSingleServerRam - HOME_RAM_RESERVE,
      );
  }

  const maxAllowedBatchRam = Math.min(
    idealBatchRam,
    largestSingleServerRam,
    currentFreeRamPool,
  );
  const dynamicMaxBatchesForTarget = Math.max(500, maxConcurrentBatches * 2);

  let currentGreedFactor = 0.9;
  let lockPlan = calculateBatch(
    ns,
    bestTarget,
    bnMults,
    currentGreedFactor,
    SPACER,
  ) as BatchPlan | null;
  let lastValidPlan = lockPlan;

  while (currentGreedFactor > 0.005) {
    currentGreedFactor -= 0.01;
    const nextPlan = calculateBatch(
      ns,
      bestTarget,
      bnMults,
      currentGreedFactor,
      SPACER,
    ) as BatchPlan | null;
    if (nextPlan === null) break;

    lockPlan = nextPlan;
    lastValidPlan = nextPlan;

    if (lockPlan.totalRam <= maxAllowedBatchRam) break;
  }

  if (lockPlan && lockPlan.totalRam > maxAllowedBatchRam && lastValidPlan)
    lockPlan = lastValidPlan;

  // Fallback-Schleife, falls die Welle immer noch zu fett für das freie RAM ist
  if (!lockPlan || lockPlan.totalRam > currentFreeRamPool) {
    currentGreedFactor = 0.4;
    lockPlan = calculateBatch(
      ns,
      bestTarget,
      bnMults,
      currentGreedFactor,
      SPACER,
    ) as BatchPlan | null;
    lastValidPlan = lockPlan;

    while (currentGreedFactor > 0.005) {
      currentGreedFactor -= 0.01;
      const nextPlan = calculateBatch(
        ns,
        bestTarget,
        bnMults,
        currentGreedFactor,
        SPACER,
      ) as BatchPlan | null;
      if (nextPlan === null) break;

      lockPlan = nextPlan;
      lastValidPlan = nextPlan;

      if (lockPlan.totalRam <= currentFreeRamPool) break;
    }

    if (lockPlan && lockPlan.totalRam > currentFreeRamPool && lastValidPlan)
      lockPlan = lastValidPlan;
  }

  if (lockPlan && lockPlan.totalRam <= currentFreeRamPool) {
    return {
      target: bestTarget,
      plan: lockPlan,
      maxBatches: dynamicMaxBatchesForTarget,
    };
  }

  return null;
}

function getNetworkRamMetrics(ns: NS, servers: string[]) {
  let totalMaxRam = 0;
  for (const s of servers) {
    if (!ns.hasRootAccess(s)) continue;
    let max = ns.getServerMaxRam(s);
    if (s === "home") max = Math.max(0, max - HOME_RAM_RESERVE);
    totalMaxRam += max;
  }
  return { totalMaxRam };
}

function getVirtualFreeRam(
  ns: NS,
  totalMaxRam: number,
  queue: JitEvent[],
): number {
  let reservedRam = 0;
  for (const ev of queue) {
    const scriptRam = ns.getScriptRam(ev.script);
    reservedRam += ev.threads * scriptRam;
  }
  return Math.max(0, totalMaxRam - reservedRam);
}

function getAvailableWorkers(ns: NS, servers: string[]): WorkerNode[] {
  const workers: WorkerNode[] = [];
  for (const s of servers) {
    if (!ns.hasRootAccess(s)) continue;
    let max = ns.getServerMaxRam(s);
    if (s === "home") max = Math.max(0, max - HOME_RAM_RESERVE);
    const used = ns.getServerUsedRam(s);
    if (max - used > 0) {
      workers.push({ hostname: s, maxRam: max, freeRam: max - used });
    }
  }
  return workers.sort((a, b) => b.freeRam - a.freeRam);
}
function executeOnWorkers(
  ns: NS,
  event: JitEvent,
  workers: WorkerNode[],
): boolean {
  // 🟢 Absoluter Failsafe: Wenn ein Event 0 Threads hat, direkt als "erfolgreich ausgeführt" markieren
  if (event.threads <= 0) return true;

  let threadsLeft = event.threads;
  const scriptRam = ns.getScriptRam(event.script);

  for (const worker of workers) {
    const maxThreadsOnWorker = Math.floor(worker.freeRam / scriptRam);
    if (maxThreadsOnWorker <= 0) continue;

    const threadsToRun = Math.min(threadsLeft, maxThreadsOnWorker);
    const pid = ns.exec(
      event.script,
      worker.hostname,
      threadsToRun,
      event.target,
      event.landTime,
      event.id,
    );

    if (pid > 0) {
      threadsLeft -= threadsToRun;
      if (threadsLeft <= 0) return true;
    }
  }
  return threadsLeft === 0;
}
