import { NS } from "@ns";
import {
  HOME_RAM_RESERVE,
  PATH_HACK,
  PATH_GROW,
  PATH_WEAKEN,
  SPACER,
} from "/lib/constants.js";
import { WorkerNode, JitEvent, ActiveBatch } from "./types.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";

// Statisches RAM Lookup zur Vermeidung träger File-System API Calls
const SCRIPT_RAM_MAP: Record<string, number> = {
  [PATH_HACK]: 1.70,
  [PATH_GROW]: 1.75,
  [PATH_WEAKEN]: 1.75,
};

const RAM_SAFETY_BUFFER_GB = 0.05;

function getUsableThreads(freeRam: number, scriptRam: number): number {
  if (!Number.isFinite(freeRam) || !Number.isFinite(scriptRam) || scriptRam <= 0) {
    return 0;
  }

  const safeFreeRam = Math.max(0, freeRam - RAM_SAFETY_BUFFER_GB);
  return Math.floor(safeFreeRam / scriptRam);
}

export function getAvailableWorkers(ns: NS, servers: string[]): WorkerNode[] {
  const nodes: WorkerNode[] = [];
  for (const s of servers) {
    if (!ns.hasRootAccess(s)) continue;

    const maxRam = Math.max(0, Math.min(100_000, ns.getServerMaxRam(s)));
    const usedRam = Math.max(0, Math.min(100_000, ns.getServerUsedRam(s)));
    let free = maxRam - usedRam;
    if (s === "home") free -= HOME_RAM_RESERVE;

    if (free > 0) {
      nodes.push({
        hostname: s,
        freeRam: free,
        maxRam: maxRam,
      });
    }
  }
  return nodes.sort((a, b) => b.freeRam - a.freeRam);
}

/**
 * Killt gezielt nur Worker-Payloads auf ALLEN Servern (inklusive home),
 * ohne den Batcher, den Orchestrator oder Daemons zu beenden.
 */
export function killWorkerPayloads(ns: NS, servers: string[]): void {
  const payloadScripts = [PATH_HACK, PATH_GROW, PATH_WEAKEN];
  for (const server of servers) {
    if (!ns.hasRootAccess(server)) continue;
    if (ns.getServerMaxRam(server) === 0) continue;

    for (const proc of ns.ps(server)) {
      if (payloadScripts.some((path) => proc.filename.includes(path))) {
        ns.kill(proc.pid);
      }
    }
  }
}

/**
 * Synchronisiert die Payload-Skripte auf alle gerooteten Netzwerk-Server.
 */
export function syncPayloads(ns: NS, serverList: string[]): void {
  for (const s of serverList) {
    if (s !== "home" && ns.hasRootAccess(s)) {
      ns.scp([PATH_HACK, PATH_GROW, PATH_WEAKEN], s, "home");
    }
  }
}

/**
 * Führt ein Event atomar auf den verfügbaren Workers aus (mit Thread-Splitting).
 * Garantiert: Entweder werden ALLE Threads gestartet oder GAR KEINE.
 */
export function executeOnWorkers(ns: NS, event: JitEvent, workers: WorkerNode[]): boolean {
  if (!Number.isFinite(event.threads) || event.threads <= 0) return false;

  const scriptRam = SCRIPT_RAM_MAP[event.script] ?? ns.getScriptRam(event.script);
  if (scriptRam <= 0) return false;

  // 1. Capacity Check
  let totalAvailableThreads = 0;
  for (const w of workers) {
    totalAvailableThreads += getUsableThreads(w.freeRam, scriptRam);
    if (totalAvailableThreads >= event.threads) break;
  }

  if (totalAvailableThreads < event.threads) return false;

  // 2. Transactional Dispatch
  let remainingThreads = event.threads;
  let chunkIndex = 0;
  const launchedPids: { pid: number; worker: WorkerNode; allocatedRam: number }[] = [];

  for (const w of workers) {
    const possible = getUsableThreads(w.freeRam, scriptRam);
    if (possible <= 0) continue;

    const toRun = Math.min(remainingThreads, possible);

    const pid = ns.exec(
      event.script,
      w.hostname,
      toRun,
      event.target,
      event.id,
      chunkIndex++
    );

    if (pid > 0) {
      const ramUsed = toRun * scriptRam;
      w.freeRam -= ramUsed; // Zieht RAM lokal vom Worker-Objekt ab!
      launchedPids.push({ pid, worker: w, allocatedRam: ramUsed });
      remainingThreads -= toRun;
    } else {
      // Rollback
      for (const item of launchedPids) {
        ns.kill(item.pid);
        item.worker.freeRam += item.allocatedRam;
      }
      ns.print(`[ERROR] ns.exec fehlgeschlagen auf ${w.hostname} für ${event.script} - Rollback ausgeführt.`);
      return false;
    }

    if (remainingThreads <= 0) return true;
  }

  return remainingThreads === 0;
}

/** Erstellt die Liste der JIT-Events für einen einzelnen Batch */
export function createBatchEvents(
  bId: number,
  target: string,
  tLand: number,
  plan: {
    hackThreads: number;
    weaken1Threads: number;
    growThreads: number;
    weaken2Threads: number;
    hackTime: number;
    weakenTime: number;
    growTime: number;
  }
): JitEvent[] {
  return [
    {
      id: `b${bId}-h`,
      batchId: bId,
      script: PATH_HACK,
      threads: plan.hackThreads,
      target,
      startTime: tLand - SPACER - plan.hackTime,
      landTime: tLand - SPACER,
    },
    {
      id: `b${bId}-w1`,
      batchId: bId,
      script: PATH_WEAKEN,
      threads: plan.weaken1Threads,
      target,
      startTime: tLand - plan.weakenTime,
      landTime: tLand,
    },
    {
      id: `b${bId}-g`,
      batchId: bId,
      script: PATH_GROW,
      threads: plan.growThreads,
      target,
      startTime: tLand + SPACER - plan.growTime,
      landTime: tLand + SPACER,
    },
    {
      id: `b${bId}-w2`,
      batchId: bId,
      script: PATH_WEAKEN,
      threads: plan.weaken2Threads,
      target,
      startTime: tLand + 2 * SPACER - plan.weakenTime,
      landTime: tLand + 2 * SPACER,
    },
  ].filter((ev) => ev.threads > 0);
}

/** Überprüft aktive Batches auf Abschluss oder Hängenbleiben und räumt sie auf */
export function cleanupActiveBatches(
  activeBatches: Map<number, ActiveBatch>,
  activeBatchIds: Set<number>,
  now: number,
  isPrepBatch: boolean,
  logger: Logger
): void {
  for (const [bId, bData] of activeBatches.entries()) {
    if (now >= bData.landEndTime) {
      activeBatches.delete(bId);
      activeBatchIds.delete(bId);

      const modeLog = isPrepBatch ? "Prep-Batch" : "HWGW-Batch";
      logger.debug(`✅ ${modeLog} b${bId} erfolgreich gelandet.`);
    } else if (now > bData.landEndTime + 3000) {
      activeBatches.delete(bId);
      activeBatchIds.delete(bId);
      logger.warn(`🧹 Watchdog: Batch b${bId} hing fest und wurde zwangsaufgeräumt.`);
    }
  }
}

export function pruneBatchFromQueue(queue: JitEvent[], batchId: number): void {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < queue.length; readIndex++) {
    if (queue[readIndex].batchId !== batchId) {
      queue[writeIndex] = queue[readIndex];
      writeIndex++;
    }
  }
  queue.length = writeIndex;
}

export function insertEventSorted(queue: JitEvent[], event: JitEvent): void {
  let low = 0;
  let high = queue.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (queue[mid].startTime < event.startTime) low = mid + 1;
    else high = mid;
  }
  queue.splice(low, 0, event);
}