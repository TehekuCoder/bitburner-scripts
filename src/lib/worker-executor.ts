import { NS } from "@ns";
import { JitEvent, WorkerNode } from "core/types";
import { HOME_RAM_RESERVE } from "./constants.js";

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
        maxRam: maxRam 
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

  const totalThreadsAvailable = workers.reduce(
    (sum, w) => sum + Math.floor(w.freeRam / scriptRam),
    0,
  );
  if (totalThreadsAvailable < event.threads) return false;

  let threadsLeft = event.threads;

  const now = Date.now();
  const delay = Math.max(0, Math.round(event.startTime - now));

  for (const w of workers) {
    const maxThreads = Math.floor(w.freeRam / scriptRam);
    if (maxThreads <= 0) continue;

    if (!ns.fileExists(event.script, w.hostname)) {
      ns.scp(event.script, w.hostname, "home");
    }

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
      threadsLeft -= threadsToRun;
      w.freeRam -= threadsToRun * scriptRam;
    }

    if (threadsLeft <= 0) return true;
  }
  return false;
}

export function pruneBatch(queue: JitEvent[], batchId: number): void {
  const filtered = queue.filter((ev) => ev.batchId !== batchId);
  queue.length = 0;
  queue.push(...filtered);
}