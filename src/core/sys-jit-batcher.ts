import { NS } from "@ns";
import { getAllServers } from "../lib/network.js";
import { patchState } from "./state-manager.js";
import { loadBnMults } from "../lib/state.js";
import { Logger } from "./logger.js";
import { JitEvent, WorkerNode, BatchPlan } from "core/types";
import { calculateBatch } from "../utils/batch-calculator.js";
import {
  PATH_GROW,
  PATH_HACK,
  PATH_WEAKEN,
  SCRIPT_RAM_BASE,
  SPACER,
  BATCH_GAP,
  BLACKLIST_DURATION,
  DYNAMIC_MAX_WEAKEN_TIME,
  HOME_RAM_RESERVE,
} from "/lib/constants.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

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
      ns.killall(s, true);
      ns.scp([PATH_HACK, PATH_GROW, PATH_WEAKEN], s, "home");
    }
  }

  const eventQueue: JitEvent[] = [];
  const targetBlacklist = new Map<string, number>();
  let nextAvailableLandTime = 0;
  let batchIdCounter = 0;

  let target: string | null = null;
  let dynamicMaxBatchesForTarget = 100;
  let batchesSentForTarget = 0;
  let lastStateUpdate = 0;
  let activePlan: BatchPlan | null = null;

  const launchedBatchParts = new Set<string>(); // Format: "batchId-scriptPath"

  logger.success(
    "🚀 Autarke JIT-Engine läuft ohne externe Planer-Abhängigkeit.",
  );

  while (true) {
    const now = Date.now();

    // 🧹 Blacklist-Hausputz direkt hier oben ausführen, damit er jeden Frame läuft
    for (const [key, expiry] of targetBlacklist.entries()) {
      if (now > expiry) {
        targetBlacklist.delete(key);
        logger.info(`🔓 Cooldown abgelaufen: ${key} ist wieder im Pool.`);
      }
    }

    const realFreeRam = getNetworkRealFreeRam(ns, servers);
    const queueRam = getQueueRam(ns, eventQueue);
    const virtualFreeRam = realFreeRam - queueRam;

    // -------------------------------------------------------------------------
    // 🎯 INTERNES TARGETING & REPLANNING
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

      const planning = internalPlanner(
        ns,
        servers,
        getNetworkMaxRam(ns, servers),
        virtualFreeRam,
        bnMults,
        targetBlacklist,
        eventQueue.length, // 🟢 FIX: Queue-Länge an Planer übergeben
      );

      if (planning) {
        if (planning.target !== target) {
          logger.warn(
            `🎯 Target-Wechsel: ${target} ➡️ ${planning.target}. Bereinige Queue.`,
          );
          eventQueue.length = 0;
          nextAvailableLandTime = 0;
          target = planning.target;
        }
        activePlan = planning.plan;
        dynamicMaxBatchesForTarget = planning.maxBatches;
        batchesSentForTarget = 0;
      } else {
        // 🟢 FIX: Nur wenn noch alte Batches laufen, lassen wir das Target aktiv ausklingen.
        // Ist die Pipeline komplett leer, nullen wir das Target, um den 5s-Sleep zu triggern.
        if (target && eventQueue.length > 0) {
          batchesSentForTarget = 0;
        } else {
          target = null;
          activePlan = null;
        }
      }

      if (!target || !activePlan) {
        logger.warn(
          "⚠️ Kein valide hackbares Ziel mit ausreichend freiem RAM gefunden. Schlafe...",
        );
        patchState(ns, {
          batcherProgress: "Warte auf RAM... | Zu wenig Netzwerk-RAM",
          batcherTarget: "Suche...",
          batcherPlan: null,
        });
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

        // ... (Hier drüber stehen deine validEvents und das eventQueue.push)
        eventQueue.push(...validEvents);
        eventQueue.sort((a, b) => a.startTime - b.startTime);

        batchesSentForTarget++;
        nextAvailableLandTime += BATCH_GAP;

        // =========================================================================
        // 🛡️ CODE-ADDITION: DAS SICHERHEITSVENTIL HIER EINFÜGEN
        // =========================================================================
        if (target && eventQueue.length === 0) {
          logger.warn(
            `⚠️ Target ${target} gewählt, aber es konnten 0 Batches generiert werden (RAM blockiert). Setze Cooldown.`,
          );

          targetBlacklist.set(target, now + 30000);

          target = null;
          activePlan = null;
          batchesSentForTarget = 0;

          continue;
        }
        // =========================================================================

        patchState(ns, {
          batcherPlan: activePlan,
          batcherTarget: target,
          batcherDynamicMaxBatches: dynamicMaxBatchesForTarget,
          batcherProgress: `Pipelines gefüllt (${batchesSentForTarget}/${dynamicMaxBatchesForTarget})`,
        });
      } else {
        // 🛑 CRITICAL FIX: Wenn die Queue leer ist und der Plan nicht passt...
        // haben wir chronischen RAM-Mangel durch externe Skripte.
        if (eventQueue.length === 0) {
          logger.warn(
            `⚠️ RAM-Deadlock verhindert: Plan benötigt ${ns.format.ram(activePlan.totalRam)}, aber nur ${ns.format.ram(virtualFreeRam)} frei. Starte Backoff...`,
          );
          target = null;
          activePlan = null;
          patchState(ns, {
            batcherProgress:
              "Warte auf RAM... | Blockiert durch externe Skripte",
            batcherTarget: "Standby",
          });
          await ns.sleep(5000); // 5 Sekunden tief schlafen statt 500ms Spam
          continue;
        }

        patchState(ns, {
          batcherProgress: `RAM temporär gesättigt | Queue: ${eventQueue.length} Events`,
        });
      }
    }

    // -------------------------------------------------------------------------
    // 2. TIMING-TICKER: SKRIPTE JUST-IN-TIME ABSCHIEẞEN (MIT DESYNC-PROTECTION)
    // -------------------------------------------------------------------------
    while (eventQueue.length > 0 && Date.now() >= eventQueue[0].startTime) {
      const event = eventQueue.shift()!;
      const lag = Date.now() - event.startTime;

      // 1. VERZÖGERUNGS-PRÜFUNG (LAG-DETECTION)
      if (lag > 30) {
        logger.warn(
          `⏳ Lag erkannt! Event ${event.id} um ${Math.round(lag)}ms verzögert.`,
        );

        // Prüfen, ob bereits andere Teile DIESES Batches laufen
        const siblingRan = [PATH_HACK, PATH_GROW, PATH_WEAKEN].some((script) =>
          launchedBatchParts.has(`${event.batchId}-${script}`),
        );

        if (!siblingRan) {
          // Szenario 1: Sauberer Prune. Nichts aus diesem Batch läuft bisher.
          logger.info(
            `🧹 Sicherer Prune: Entferne restliche Events für Batch #${event.batchId}.`,
          );
          pruneBatch(eventQueue, event.batchId);
        } else {
          // Szenario 2: Status-Vergiftung. Ein Teil läuft schon, die Balance bricht.
          logger.error(
            `💥 Kaskaden-Gefahr! Batch #${event.batchId} unvollständig gestartet. Bereinige Pipeline für ${event.target}.`,
          );

          // Nur die Events DIESES Targets löschen, falls du später Multi-Targeting nutzt
          const keepOtherTargets = eventQueue.filter(
            (ev) => ev.target !== event.target,
          );
          eventQueue.length = 0;
          eventQueue.push(...keepOtherTargets);

          // Target resetten, damit der Planer im nächsten Frame sofort reagiert
          target = null;
        }
        continue;
      }

      // 2. ARBEITER-ZUWEISUNG & ABSCHUSS
      const workers = getAvailableWorkers(ns, servers);
      const dispatched = executeOnWorkers(ns, event, workers);

      if (!dispatched) {
        logger.error(
          `🛑 RAM-Engpass/Fragmentierung bei ${event.target} (Welle: ${event.id}). Leite Recovery ein...`,
        );
        ns.toast(`RAM-Engpass bei ${event.target}!`, "warning", 3000);

        // 1. Nutzt direkt eure vorhandene Map für 45 Sekunden Sperre
        targetBlacklist.set(event.target, now + 45000);

        // 2. Chirurgische Amputation: Nur diesen einen Batch löschen
        const failedBatchId = event.batchId;
        const filteredQueue = eventQueue.filter(
          (ev) => ev.batchId !== failedBatchId,
        );
        eventQueue.length = 0;
        eventQueue.push(...filteredQueue);

        // 3. Zustand zurücksetzen, um im nächsten Frame neu zu evaluieren
        if (target === event.target) {
          target = null;
          activePlan = null;
          batchesSentForTarget = 0;
        }

        // 4. Frame abbrechen, um in die neue Planung zu gehen
        break;
      }

      // Registriere den erfolgreichen Teil-Abschuss
      launchedBatchParts.add(`${event.batchId}-${event.script}`);

      // Speicher-Bereinigung für das Set (alte Batch-IDs entfernen)
      if (launchedBatchParts.size > 200) {
        const iterator = launchedBatchParts.values();
        for (let i = 0; i < 20; i++) {
          const res = iterator.next();
          if (res.done || res.value === undefined) break;
          launchedBatchParts.delete(res.value);
        }
      }
    }

    if (now - lastStateUpdate > 1000) {
      patchState(ns, {
        batcherProgress: `Executing JIT | Queue: ${eventQueue.length} Events`,
        batcherRamNeeded: Math.max(0, realFreeRam - virtualFreeRam),
      });
      lastStateUpdate = now;
    }

    // -------------------------------------------------------------------------
    // ⚡ OPTIMIERTER HOCHPRÄZISIONS-SCHLEIFEN-TAKT
    // -------------------------------------------------------------------------
    if (eventQueue.length > 0) {
      const timeToNextEvent = eventQueue[0].startTime - Date.now();

      if (timeToNextEvent > 0) {
        await ns.sleep(timeToNextEvent);
      } else {
        await ns.sleep(1);
      }
    } else {
      await ns.sleep(50);
    }
  }
}

function internalPlanner(
  ns: NS,
  servers: string[],
  totalUsableMaxRam: number,
  currentFreeRamPool: number,
  bnMults: any,
  targetBlacklist: Map<string, number>,
  queueLength: number,
): { target: string; plan: BatchPlan; maxBatches: number } | null {
  const playerHackLevel = ns.getHackingLevel();

  const targets = servers.filter(
    (s) =>
      ns.hasRootAccess(s) &&
      ns.getServerMaxMoney(s) > 0 &&
      ns.getServerRequiredHackingLevel(s) <= playerHackLevel &&
      !targetBlacklist.has(s),
  );

  let bestTarget: string | null = null;
  let highestScore = 0;

  const evaluationRam =
    currentFreeRamPool <= 0 ? totalUsableMaxRam : currentFreeRamPool;

  for (const s of targets) {
    const startGreed = evaluationRam < 256 ? 0.01 : 0.1;
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

    if (!testPlan || testPlan.totalRam > totalUsableMaxRam) continue;
    if (testPlan.executionTime > DYNAMIC_MAX_WEAKEN_TIME) continue;

    const score = ns.getServerMaxMoney(s);
    if (score > highestScore) {
      highestScore = score;
      bestTarget = s;
    }
  }

  if (!bestTarget) return null;

  // -------------------------------------------------------------------------
  // 🛡️ EMERGENCY RECOVERY- & PREPARATION-MODUS (Anti-Deadlock)
  // -------------------------------------------------------------------------
  const curSec = ns.getServerSecurityLevel(bestTarget);
  const minSec = ns.getServerMinSecurityLevel(bestTarget);
  const curMoney = ns.getServerMoneyAvailable(bestTarget);
  const maxMoney = ns.getServerMaxMoney(bestTarget);
  const weakenScriptRam = ns.getScriptRam(PATH_WEAKEN);
  const growScriptRam = ns.getScriptRam(PATH_GROW);

  if (curSec > minSec + 0.5 || curMoney < maxMoney * 0.9) {
    let w1Threads = 0;
    let gThreads = 0;
    let w2Threads = 0;

    // Wenn die Queue leer ist, MÜSSEN wir uns am aktuell freien RAM orientieren,
    // da keine eigenen Wellen mehr auslaufen, die Speicher freigeben!
    const availableRamForPrep =
      queueLength === 0 ? currentFreeRamPool : totalUsableMaxRam;

    if (curSec > minSec + 0.5) {
      const secDeficit = curSec - minSec;
      const targetWThreads = Math.ceil(secDeficit / 0.05);
      const maxWThreads = Math.floor(availableRamForPrep / weakenScriptRam);
      w1Threads = Math.max(1, Math.min(targetWThreads, maxWThreads));
    } else {
      const unitRam = 12 * growScriptRam + weakenScriptRam;
      const maxUnits = Math.floor(availableRamForPrep / unitRam);

      if (maxUnits > 0) {
        gThreads = maxUnits * 12;
        w2Threads = maxUnits;
      } else {
        gThreads = Math.max(1, Math.floor(availableRamForPrep / growScriptRam));
      }
    }

    const totalPrepRam =
      (w1Threads + w2Threads) * weakenScriptRam + gThreads * growScriptRam;

    // Wenn selbst für 1 Thread kein RAM da ist und die Queue leer ist -> Abort, sauber schlafen.
    if (
      totalPrepRam <= 0 ||
      (queueLength === 0 && totalPrepRam > currentFreeRamPool)
    ) {
      return null;
    }

    const serverMock = ns.getServer(bestTarget);
    serverMock.hackDifficulty = serverMock.minDifficulty;
    const wTime = ns.formulas!.hacking.weakenTime(serverMock, ns.getPlayer());
    const gTime = ns.formulas!.hacking.growTime(serverMock, ns.getPlayer());

    const prepPlan: BatchPlan = {
      target: bestTarget,
      hackThreads: 0,
      weaken1Threads: w1Threads,
      growThreads: gThreads,
      weaken2Threads: w2Threads,
      hackDelay: 0,
      weaken1Delay: 0,
      growDelay: 0,
      weaken2Delay: 0,
      hackTime: 0,
      growTime: gTime,
      weakenTime: wTime,
      totalRam: totalPrepRam,
      executionTime: wTime,
    };

    return {
      target: bestTarget,
      plan: prepPlan,
      maxBatches: 1,
    };
  }

  // -------------------------------------------------------------------------
  // 🚀 STANDARD HWGW-PLANUNG (Server ist im optimalen Zustand)
  // -------------------------------------------------------------------------
  const serverMock = ns.getServer(bestTarget);
  serverMock.hackDifficulty = serverMock.minDifficulty;
  const weakenTime = ns.formulas!.hacking.weakenTime(
    serverMock,
    ns.getPlayer(),
  );

  const maxConcurrentBatches = Math.max(1, Math.floor(weakenTime / SPACER));
  const idealBatchRam = totalUsableMaxRam / maxConcurrentBatches;

  const maxAllowedBatchRam = Math.min(
    idealBatchRam,
    currentFreeRamPool > 0 ? currentFreeRamPool : totalUsableMaxRam,
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
    if (lockPlan.totalRam <= maxAllowedBatchRam) break;
  }

  // Fall A: Plan passt perfekt in den aktuellen RAM-Pool
  if (lockPlan && lockPlan.totalRam <= currentFreeRamPool) {
    return {
      target: bestTarget,
      plan: lockPlan,
      maxBatches: dynamicMaxBatchesForTarget,
    };
  }

  // Fall B: Plan ist zu groß, aber alte Wellen fliegen noch (RAM wird bald frei)
  if (lockPlan && lockPlan.totalRam > currentFreeRamPool && queueLength > 0) {
    return {
      target: bestTarget,
      plan: lockPlan,
      maxBatches: dynamicMaxBatchesForTarget,
    };
  }

  // Fall C: Pipeline leer UND minimaler Batch blockiert wegen chronischem RAM-Mangel.
  // Wir werfen ein minimales Weaken-Event ein, um den Takt zu halten, statt einzuschlafen!
  if (lockPlan && queueLength === 0) {
    const fallbackPlan: BatchPlan = {
      target: bestTarget,
      hackThreads: 0,
      weaken1Threads: 1,
      growThreads: 0,
      weaken2Threads: 0,
      hackDelay: 0,
      weaken1Delay: 0,
      growDelay: 0,
      weaken2Delay: 0,
      hackTime: 0,
      growTime: 0,
      weakenTime: weakenTime,
      totalRam: weakenScriptRam,
      executionTime: weakenTime,
    };

    if (fallbackPlan.totalRam <= currentFreeRamPool) {
      return {
        target: bestTarget,
        plan: fallbackPlan,
        maxBatches: 1,
      };
    }
  }

  return null;
}
function getAvailableWorkers(ns: NS, servers: string[]): WorkerNode[] {
  const workers: WorkerNode[] = [];
  for (const s of servers) {
    if (!ns.hasRootAccess(s)) continue;
    let max = ns.getServerMaxRam(s);
    if (s === "home") max = Math.max(0, max - HOME_RAM_RESERVE);
    const used = ns.getServerUsedRam(s);
    const free = max - used;

    if (Math.floor(free / SCRIPT_RAM_BASE) > 0) {
      workers.push({ hostname: s, maxRam: max, freeRam: free });
    }
  }
  return workers.sort((a, b) => b.freeRam - a.freeRam);
}

function executeOnWorkers(
  ns: NS,
  event: JitEvent,
  workers: WorkerNode[],
): boolean {
  if (event.threads <= 0) return true;

  let threadsLeft = event.threads;
  const scriptRam = ns.getScriptRam(event.script);
  const spawnedPids: number[] = [];

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
      spawnedPids.push(pid);
      threadsLeft -= threadsToRun;
      worker.freeRam -= threadsToRun * scriptRam;
      if (threadsLeft <= 0) return true;
    }
  }

  if (threadsLeft > 0) {
    for (const pid of spawnedPids) ns.kill(pid);
    return false;
  }
  return true;
}

function getNetworkRealFreeRam(ns: NS, servers: string[]): number {
  let totalFreeRam = 0;
  for (const s of servers) {
    if (!ns.hasRootAccess(s)) continue;
    let max = ns.getServerMaxRam(s);
    if (s === "home") max = Math.max(0, max - HOME_RAM_RESERVE);
    const used = ns.getServerUsedRam(s);
    const free = max - used;

    const usableThreads = Math.floor(free / SCRIPT_RAM_BASE);
    if (usableThreads > 0) {
      totalFreeRam += usableThreads * SCRIPT_RAM_BASE;
    }
  }
  return totalFreeRam;
}

function getQueueRam(ns: NS, queue: any[]): number {
  let totalRam = 0;
  for (const ev of queue) {
    totalRam += ev.threads * ns.getScriptRam(ev.script);
  }
  return totalRam;
}

function getNetworkMaxRam(ns: NS, servers: string[]): number {
  let totalMax = 0;
  for (const s of servers) {
    if (!ns.hasRootAccess(s)) continue;
    let max = ns.getServerMaxRam(s);
    if (s === "home") max = Math.max(0, max - HOME_RAM_RESERVE);

    const maxUsableThreads = Math.floor(max / SCRIPT_RAM_BASE);
    totalMax += maxUsableThreads * SCRIPT_RAM_BASE;
  }
  return totalMax;
}

function pruneBatch(queue: JitEvent[], batchId: number): void {
  const filtered = queue.filter((ev) => ev.batchId !== batchId);
  // Leert die originale Const-Queue und füllt sie ohne die betroffenen Batch-Events
  queue.length = 0;
  queue.push(...filtered);
}
