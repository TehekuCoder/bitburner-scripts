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
  return nodes.sort((a, b) => b.freeRam - a.freeRam);
}

export function executeOnWorkers(
  ns: NS,
  event: JitEvent,
  workers: WorkerNode[],
): boolean {
  const scriptRam = ns.getScriptRam(event.script);
  if (scriptRam === 0) return false;

  const totalThreadsAvailable = workers.reduce(
    (sum, w) => sum + Math.floor(w.freeRam / scriptRam),
    0,
  );
  if (totalThreadsAvailable < event.threads) return false;

  let threadsLeft = event.threads;
  const now = Date.now();
  const delay = Math.max(0, Math.round(event.startTime - now));

  // 🛡️ Rollback-Tracking für atomare Ausführung
  const spawnedPids: number[] = [];

  for (const w of workers) {
    const maxThreads = Math.floor(w.freeRam / scriptRam);
    if (maxThreads <= 0) continue;

    const threadsToRun = Math.min(threadsLeft, maxThreads);

    const pid = ns.exec(
      event.script,
      w.hostname,
      threadsToRun,
      event.target,
      delay,
      event.batchId,
      event.id,
    );

    if (pid > 0) {
      spawnedPids.push(pid);
      threadsLeft -= threadsToRun;
      w.freeRam -= threadsToRun * scriptRam;
    } else {
      // ns.exec ist fehlgeschlagen -> Dispatch-Abbruch
      break;
    }

    if (threadsLeft <= 0) return true;
  }

  // 🚨 ROLLBACK: Falls nicht alle Threads gestartet werden konnten,
  // töten wir die verwaisten Teil-Prozesse, um Batch-Desyncs zu verhindern.
  for (const pid of spawnedPids) {
    ns.kill(pid);
  }

  return false;
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