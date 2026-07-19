import { NS, Server } from "@ns";
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
  
  // 🟢 NEU: Verhindert das endlose Spammen von Prep-Skripten
  let prepEndTime = 0; 

  let target: string | null = null;
  let dynamicMaxBatchesForTarget = 100;
  let batchesSentForTarget = 0;
  let lastStateUpdate = 0;
  let activePlan: BatchPlan | null = null;

  const launchedBatchParts = new Set<string>();

  logger.success(
    "🚀 Autarke JIT-Engine läuft ohne externe Planer-Abhängigkeit.",
  );

  while (true) {
    const now = Date.now();

    // 🧹 Blacklist-Hausputz
    for (const [key, expiry] of targetBlacklist.entries()) {
      if (now > expiry) {
        targetBlacklist.delete(key);
        logger.info(`🔓 Cooldown abgelaufen: ${key} ist wieder im Pool.`);
      }
    }

    // 🟢 NEU: Sicherheits-Bremse für die Prep-Phase
    // Wenn die Queue leer ist, aber noch ein Prep-Batch auf dem Netzwerk reift,
    // warten wir einfach ab, anstatt den Server mit neuen Prep-Skripten zu fluten.
    if (eventQueue.length === 0 && now < prepEndTime) {
      if (now - lastStateUpdate > 1000) {
        patchState(ns, {
          batcherProgress: `Warte auf Prep-Effekt (${Math.round((prepEndTime - now) / 1000)}s)`,
        });
        lastStateUpdate = now;
      }
      await ns.sleep(250);
      continue;
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
        eventQueue.length,
      );

      if (planning) {
        if (planning.target !== target) {
          logger.warn(
            `🎯 Target-Wechsel: ${target} ➡️ ${planning.target}. Bereinige Queue.`,
          );
          eventQueue.length = 0;
          nextAvailableLandTime = 0;
          prepEndTime = 0; // 🟢 Reset bei Target-Wechsel
          target = planning.target;
        }
        activePlan = planning.plan;
        dynamicMaxBatchesForTarget = planning.maxBatches;
        batchesSentForTarget = 0;
      } else {
        if (target && eventQueue.length > 0) {
          batchesSentForTarget = 0;
        } else {
          target = null;
          activePlan = null;
          prepEndTime = 0; // 🟢 Reset
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

        eventQueue.push(...validEvents);
        eventQueue.sort((a, b) => a.startTime - b.startTime);

        batchesSentForTarget++;
        nextAvailableLandTime += BATCH_GAP;

        // 🟢 NEU: Erkennung eines reinen Prep-Batches. 
        // Wenn keine Hack-Threads geplant wurden, sperren wir das System, bis die Weaken-Laufzeit durch ist (+ 1 Sekunde Puffer).
        if (activePlan.hackThreads === 0) {
          prepEndTime = now + activePlan.weakenTime + 1000;
          logger.info(`🚨 Prep-Welle für ${target} abgefeuert. Reifezeit: ${Math.round(activePlan.weakenTime / 1000)}s`);
        }

        if (target && eventQueue.length === 0) {
          logger.warn(
            `⚠️ Target ${target} gewählt, aber es konnten 0 Batches generiert werden (RAM blockiert). Setze Cooldown.`,
          );
          targetBlacklist.set(target, now + 30000);
          target = null;
          activePlan = null;
          batchesSentForTarget = 0;
          prepEndTime = 0; // 🟢 Reset
          continue;
        }

        patchState(ns, {
          batcherPlan: activePlan,
          batcherTarget: target,
          batcherDynamicMaxBatches: dynamicMaxBatchesForTarget,
          batcherProgress: `Pipelines gefüllt (${batchesSentForTarget}/${dynamicMaxBatchesForTarget})`,
        });
      } else {
        if (eventQueue.length === 0) {
          logger.warn(
            `⚠️ RAM-Deadlock verhindert: Plan benötigt ${ns.format.ram(activePlan.totalRam)}, aber nur ${ns.format.ram(virtualFreeRam)} frei. Starte Backoff...`,
          );
          target = null;
          activePlan = null;
          prepEndTime = 0; // 🟢 Reset
          patchState(ns, {
            batcherProgress: "Warte auf RAM... | Blockiert durch externe Skripte",
            batcherTarget: "Standby",
          });
          await ns.sleep(5000);
          continue;
        }

        patchState(ns, {
          batcherProgress: `RAM temporär gesättigt | Queue: ${eventQueue.length} Events`,
        });
      }
    }

    // -------------------------------------------------------------------------
    // 2. TIMING-TICKER: SKRIPTE JUST-IN-TIME ABSCHIEẞEN
    // -------------------------------------------------------------------------
    while (eventQueue.length > 0 && Date.now() >= eventQueue[0].startTime) {
      const event = eventQueue.shift()!;
      const lag = Date.now() - event.startTime;

      if (lag > 30) {
        logger.warn(`⏳ Lag erkannt! Event ${event.id} um ${Math.round(lag)}ms verzögert.`);
        const siblingRan = [PATH_HACK, PATH_GROW, PATH_WEAKEN].some((script) =>
          launchedBatchParts.has(`${event.batchId}-${script}`),
        );

        if (!siblingRan) {
          logger.info(`🧹 Sicherer Prune: Entferne restliche Events für Batch #${event.batchId}.`);
          pruneBatch(eventQueue, event.batchId);
        } else {
          logger.error(`💥 Kaskaden-Gefahr! Batch #${event.batchId} unvollständig gestartet. Bereinige Pipeline für ${event.target}.`);
          const keepOtherTargets = eventQueue.filter((ev) => ev.target !== event.target);
          eventQueue.length = 0;
          eventQueue.push(...keepOtherTargets);
          target = null;
          prepEndTime = 0; // 🟢 Reset
        }
        continue;
      }

      const workers = getAvailableWorkers(ns, servers);
      const dispatched = executeOnWorkers(ns, event, workers);

      if (!dispatched) {
        logger.error(`🛑 RAM-Engpass bei ${event.target} (Welle: ${event.id}). Leite Recovery ein...`);
        ns.toast(`RAM-Engpass bei ${event.target}!`, "warning", 3000);

        targetBlacklist.set(event.target, now + 45000);
        const failedBatchId = event.batchId;
        const filteredQueue = eventQueue.filter((ev) => ev.batchId !== failedBatchId);
        eventQueue.length = 0;
        eventQueue.push(...filteredQueue);

        if (target === event.target) {
          target = null;
          activePlan = null;
          batchesSentForTarget = 0;
          prepEndTime = 0; // 🟢 Reset
        }
        break;
      }

      launchedBatchParts.add(`${event.batchId}-${event.script}`);

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

// =========================================================================
// 🛠️ HILFSFUNKTIONEN & JIT-PLANER (Typensicher für Strict-Mode)
// =========================================================================

function internalPlanner(
  ns: NS,
  servers: string[],
  maxRam: number,
  virtualFreeRam: number,
  bnMults: any,
  targetBlacklist: Map<string, number>,
  queueLength: number
): { target: string; plan: BatchPlan; maxBatches: number } | null {
  const player = ns.getPlayer();
  let bestTarget: string | null = null;
  let bestScore = -1;
  let bestPlan: BatchPlan | null = null;
  let maxBatches = 100;

  // 1. Filtere alle validen, hackbaren Server
  const targets = servers.filter((s) => {
    if (targetBlacklist.has(s)) return false;
    if (!ns.hasRootAccess(s)) return false;
    const sObj = ns.getServer(s);
    if (!sObj.moneyMax || sObj.moneyMax <= 0) return false;
    if ((sObj.requiredHackingSkill ?? 0) > player.skills.hacking) return false;
    return true;
  });

  for (const t of targets) {
    const server = ns.getServer(t);
    
    // 🛡️ Sicheres Entpacken optionaler Werte für den TS-Compiler
    const minDifficulty = server.minDifficulty ?? 1;
    const hackDifficulty = server.hackDifficulty ?? 1;
    const moneyMax = server.moneyMax ?? 0;
    const moneyAvailable = server.moneyAvailable ?? 0;

    if (moneyMax <= 0) continue; // Absicherung für Divisionen

    // Check, ob der Server bereits im Idealzustand ist
    const isPrepped = 
      hackDifficulty <= minDifficulty + 0.01 && 
      moneyAvailable >= moneyMax * 0.99;

    if (!isPrepped) {
      // 🛠️ FALL A: PREP-PHASE (Server korrigieren)
      const weakenPotency = 0.05 * (bnMults.ServerWeakenRate ?? 1.0);
      let weaken1Threads = 0;
      let growThreads = 0;
      let weaken2Threads = 0;

      const diffAmt = hackDifficulty - minDifficulty;
      if (diffAmt > 0) {
        weaken1Threads = Math.ceil(diffAmt / weakenPotency);
      }

      if (moneyAvailable < moneyMax) {
        // Virtuellen Server klonen und für TS sauber typisieren
        const virtualServer: Server = { 
          ...server,
          hackDifficulty: minDifficulty,
          moneyAvailable: Math.max(1, moneyAvailable)
        };
        
        if (ns.formulas && ns.formulas.hacking) {
          growThreads = Math.ceil(ns.formulas.hacking.growThreads(virtualServer, player, moneyMax));
        } else {
          growThreads = Math.ceil(ns.getServerGrowth(t) / 10); 
        }
        const growSec = ns.growthAnalyzeSecurity(growThreads, t);
        weaken2Threads = Math.ceil(growSec / weakenPotency);
      }

      if (weaken1Threads === 0 && growThreads === 0) continue;

      const tW = ns.formulas?.hacking?.weakenTime(server, player) ?? ns.getWeakenTime(t);
      const tG = ns.formulas?.hacking?.growTime(server, player) ?? ns.getGrowTime(t);

      const ramGrow = ns.getScriptRam(PATH_GROW);
      const ramWeaken = ns.getScriptRam(PATH_WEAKEN);
      const totalRam = (weaken1Threads + weaken2Threads) * ramWeaken + growThreads * ramGrow;

      // Sicherheits-Check: Passt die Prep-Welle überhaupt ins RAM?
      if (totalRam > virtualFreeRam && ramWeaken > virtualFreeRam) continue;

      const prepPlan: BatchPlan = {
        target: t,
        hackThreads: 0,
        weaken1Threads,
        growThreads,
        weaken2Threads,
        hackDelay: 0,
        weaken1Delay: 0,
        growDelay: 0,
        weaken2Delay: 0,
        hackTime: 0,
        growTime: tG,
        weakenTime: tW,
        totalRam,
        executionTime: tW,
      };

      // Score für Priorisierung berechnen
      const score = moneyMax / tW;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = t;
        bestPlan = prepPlan;
        maxBatches = 1; 
      }
    } else {
      // 💰 FALL B: HWGW-BATCHING (Server melken)
      let optimalPlan: BatchPlan | null = null;
      const startGreed = virtualFreeRam < 256 ? 0.01 : 0.1;

      for (let greed = 0.95; greed >= startGreed; greed -= 0.05) {
        const p = calculateBatch(ns, t, bnMults, greed, SPACER);
        if (p && p.totalRam <= virtualFreeRam) {
          optimalPlan = p;
          break;
        }
      }

      if (optimalPlan) {
        const pctPerThread = ns.formulas.hacking.hackPercent(server, player);
        const revenue = optimalPlan.hackThreads * pctPerThread * moneyMax;
        const score = revenue / (optimalPlan.weakenTime / 1000);

        if (score > bestScore) {
          bestScore = score;
          bestTarget = t;
          bestPlan = optimalPlan;
          maxBatches = Math.floor(virtualFreeRam / optimalPlan.totalRam);
          if (maxBatches > 100) maxBatches = 100;
          if (maxBatches < 1) maxBatches = 1;
        }
      }
    }
  }

  if (!bestTarget || !bestPlan) return null;
  return { target: bestTarget, plan: bestPlan, maxBatches };
}

function getNetworkMaxRam(ns: NS, servers: string[]): number {
  let total = servers
    .filter((s) => ns.hasRootAccess(s) && s !== "home")
    .reduce((sum, s) => sum + ns.getServerMaxRam(s), 0);
  
  total += Math.max(0, ns.getServerMaxRam("home") - HOME_RAM_RESERVE);
  return total;
}

function getNetworkRealFreeRam(ns: NS, servers: string[]): number {
  let free = servers
    .filter((s) => ns.hasRootAccess(s) && s !== "home")
    .reduce((sum, s) => sum + (ns.getServerMaxRam(s) - ns.getServerUsedRam(s)), 0);

  free += Math.max(0, ns.getServerMaxRam("home") - ns.getServerUsedRam("home") - HOME_RAM_RESERVE);
  return free;
}

function getQueueRam(ns: NS, queue: JitEvent[]): number {
  let sum = 0;
  for (const ev of queue) {
    sum += ev.threads * ns.getScriptRam(ev.script);
  }
  return sum;
}

function pruneBatch(queue: JitEvent[], batchId: number): void {
  const filtered = queue.filter((ev) => ev.batchId !== batchId);
  queue.length = 0;
  queue.push(...filtered);
}

function getAvailableWorkers(ns: NS, servers: string[]): WorkerNode[] {
  const nodes: WorkerNode[] = [];
  for (const s of servers) {
    if (!ns.hasRootAccess(s)) continue;
    let free = ns.getServerMaxRam(s) - ns.getServerUsedRam(s);
    if (s === "home") free -= HOME_RAM_RESERVE;
    
    if (free > 0) {
      // 💡 Nutzt 'hostname' passend zu deinem Template-Interface
      nodes.push({ hostname: s, freeRam: free } as WorkerNode);
    }
  }
  return nodes.sort((a, b) => b.freeRam - a.freeRam);
}

function executeOnWorkers(ns: NS, event: JitEvent, workers: WorkerNode[]): boolean {
  const scriptRam = ns.getScriptRam(event.script);
  let threadsLeft = event.threads;

  for (const w of workers) {
    const maxThreadsOnWorker = Math.floor(w.freeRam / scriptRam);
    if (maxThreadsOnWorker <= 0) continue;

    const threadsToRun = Math.min(threadsLeft, maxThreadsOnWorker);
    
    // 💡 Nutzt w.hostname statt w.name
    const pid = ns.exec(
      event.script, 
      w.hostname, 
      threadsToRun, 
      event.target, 
      event.landTime.toString(), 
      event.batchId.toString()
    );

    if (pid > 0) {
      threadsLeft -= threadsToRun;
      w.freeRam -= threadsToRun * scriptRam;
    }

    if (threadsLeft <= 0) return true;
  }
  
  return false; 
}