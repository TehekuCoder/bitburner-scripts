import { NS } from "@ns";
import {
  HOME_RAM_RESERVE,
  PATH_HACK,
  PATH_GROW,
  PATH_WEAKEN,
} from "/lib/constants.js";
import { JitEvent } from "/lib/types/batcher.js";
import { WorkerNode } from "/lib/types/network.js";
import { getUsableThreads } from "./batcher-helpers.js";

// Statisches RAM Lookup zur Vermeidung träger File-System API Calls
const SCRIPT_RAM_MAP: Record<string, number> = {
  [PATH_HACK]: 1.7,
  [PATH_GROW]: 1.75,
  [PATH_WEAKEN]: 1.75,
};

/** Scanned das Netzwerk nach gerooteten Servern mit freiem RAM */
export function getAvailableWorkers(ns: NS, servers: string[]): WorkerNode[] {
  const nodes: WorkerNode[] = [];
  for (const s of servers) {
    if (!ns.hasRootAccess(s)) continue;

    const maxRam = Math.max(0, ns.getServerMaxRam(s));
    const usedRam = Math.max(0, ns.getServerUsedRam(s));
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

/** Killt gezielt Worker-Payloads auf allen Servern */
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

/** Synchronisiert Payload-Skripte im Netzwerk */
export function syncPayloads(ns: NS, serverList: string[]): void {
  for (const s of serverList) {
    if (s !== "home" && ns.hasRootAccess(s)) {
      ns.scp([PATH_HACK, PATH_GROW, PATH_WEAKEN], s, "home");
    }
  }
}

/**
 * Führt ein Event atomar auf den verfügbaren Workers aus (Thread-Splitting).
 * Transaktionssicher: Entweder werden ALLE Threads gestartet oder GAR KEINE (Rollback).
 */
export function executeOnWorkers(
  ns: NS,
  event: JitEvent,
  workers: WorkerNode[],
): boolean {
  if (!Number.isFinite(event.threads) || event.threads <= 0) return false;

  const scriptRam =
    SCRIPT_RAM_MAP[event.script] ?? ns.getScriptRam(event.script);
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
  const launchedPids: {
    pid: number;
    worker: WorkerNode;
    allocatedRam: number;
  }[] = [];

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
      chunkIndex++,
    );

    if (pid > 0) {
      const ramUsed = toRun * scriptRam;
      w.freeRam -= ramUsed;
      launchedPids.push({ pid, worker: w, allocatedRam: ramUsed });
      remainingThreads -= toRun;
    } else {
      // Rollback bei Fehlschlag
      for (const item of launchedPids) {
        ns.kill(item.pid);
        item.worker.freeRam += item.allocatedRam;
      }
      ns.print(
        `[ERROR] ns.exec fehlgeschlagen auf ${w.hostname} für ${event.script} - Rollback ausgeführt.`,
      );
      return false;
    }

    if (remainingThreads <= 0) return true;
  }

  return remainingThreads === 0;
}