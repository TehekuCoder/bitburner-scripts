import { NS } from "@ns";
import { HOME_RAM_RESERVE } from "/lib/constants.js";
import { WorkerNode, JitEvent } from "./types.js";

export function getAvailableWorkers(ns: NS, servers: string[]): WorkerNode[] {
  const nodes: WorkerNode[] = [];
  for (const s of servers) {
    if (!ns.hasRootAccess(s)) continue;
    
    const maxRam = ns.getServerMaxRam(s);
    let free = maxRam - ns.getServerUsedRam(s);
    if (s === "home") free -= HOME_RAM_RESERVE;

    if (free > 0) {
      nodes.push({
        hostname: s,
        freeRam: free,
        maxRam: maxRam,
      });
    }
  }
  // Höchster freier RAM zuerst für effiziente Verteilung
  return nodes.sort((a, b) => b.freeRam - a.freeRam);
}

/**
 * Führt ein Event atomar auf den verfügbaren Workers aus (mit Thread-Splitting).
 * Garantiert: Entweder werden ALLE Threads gestartet oder GAR KEINE.
 */
// lib/worker-executor.ts
export function executeOnWorkers(ns: NS, event: JitEvent, workers: WorkerNode[]): boolean {
  const scriptRam = ns.getScriptRam(event.script);
  if (scriptRam <= 0 || event.threads <= 0) return false;

  // 1. Capacity Check
  let totalAvailableThreads = 0;
  for (const w of workers) {
    totalAvailableThreads += Math.floor(w.freeRam / scriptRam);
    if (totalAvailableThreads >= event.threads) break;
  }

  if (totalAvailableThreads < event.threads) return false;

  // 2. Transactional Dispatch
  let remainingThreads = event.threads;
  let chunkIndex = 0;
  const launchedPids: { pid: number; worker: WorkerNode; allocatedRam: number }[] = [];

  for (const w of workers) {
    const possible = Math.floor(w.freeRam / scriptRam);
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
      w.freeRam -= ramUsed;
      launchedPids.push({ pid, worker: w, allocatedRam: ramUsed });
      remainingThreads -= toRun;
    } else {
      // Rollback: Prozesse beenden & RAM-Buffer der Worker wieder freigeben
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
/**
 * Entzieht alle noch nicht gelaufenen Events eines abgebrochenen Batches in-place.
 * Verwendet einen Two-Pointer Swap in O(N) ohne Memory Allocation / GC-Spikes.
 */
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

/**
 * Fügt ein Event via Binary Search in O(log N) an der korrekten zeitlichen Position ein.
 */
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