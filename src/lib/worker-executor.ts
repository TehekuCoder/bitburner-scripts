import { NS } from "@ns";
import {
  HOME_RAM_RESERVE,
  PATH_HACK,
  PATH_GROW,
  PATH_WEAKEN
} from "./runtime/batcher.js";
import { DispatchResult, JitEvent } from "/shared/types/batcher.js";
import { WorkerNode } from "/shared/types/network.js";
import { getUsableThreads } from "./batcher-helpers.js";

const SCRIPT_RAM_MAP: Record<string, number> = {
  [PATH_HACK]: 1.7,
  [PATH_GROW]: 1.75,
  [PATH_WEAKEN]: 1.75,
};

// Statischer Max-RAM Cache vermeidet Hunderte ns.getServerMaxRam Calls pro Sekunde
const MAX_RAM_CACHE = new Map<string, number>();

/** Resettet den Cache bei gekauften/geupgradeten Servern */
export function invalidateMaxRamCache(): void {
  MAX_RAM_CACHE.clear();
}

/** Scanned das Netzwerk nach gerooteten Servern mit freiem RAM */
export function getAvailableWorkers(ns: NS, servers: string[]): WorkerNode[] {
  const nodes: WorkerNode[] = [];

  for (const s of servers) {
    if (!ns.hasRootAccess(s)) continue;

    let maxRam = MAX_RAM_CACHE.get(s);
    if (maxRam === undefined) {
      maxRam = Math.max(0, ns.getServerMaxRam(s));
      MAX_RAM_CACHE.set(s, maxRam);
    }

    if (maxRam <= 0) continue;

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
    if ((MAX_RAM_CACHE.get(server) ?? ns.getServerMaxRam(server)) === 0) continue;

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
 * Gibt den exakten Grund zurück, falls die Ausführung scheitert.
 */
export function executeOnWorkers(
  ns: NS,
  event: JitEvent,
  workers: WorkerNode[],
): DispatchResult {
  if (!Number.isFinite(event.threads) || event.threads <= 0) return "EXEC_FAIL";

  const scriptRam =
    SCRIPT_RAM_MAP[event.script] ?? ns.getScriptRam(event.script);
  if (scriptRam <= 0) return "EXEC_FAIL";

  // 1. Capacity Check
  let totalAvailableThreads = 0;
  for (const w of workers) {
    totalAvailableThreads += getUsableThreads(w.freeRam, scriptRam);
    if (totalAvailableThreads >= event.threads) break;
  }

  // RAM reicht aktuell nicht – KEIN Absturz, nur temporär voll!
  if (totalAvailableThreads < event.threads) return "NO_RAM";

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

    // Auto-Sync Fallback: Stellt sicher, dass das Skript auf dem Worker existiert
    if (w.hostname !== "home" && !ns.fileExists(event.script, w.hostname)) {
      ns.scp(event.script, w.hostname, "home");
    }

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
      // Rollback bei echtem ns.exec-Fehlversuch
      for (const item of launchedPids) {
        ns.kill(item.pid);
        item.worker.freeRam += item.allocatedRam;
      }
      ns.print(
        `[ERROR] ns.exec fehlgeschlagen auf ${w.hostname} für ${event.script} (Target: ${event.target}). Rollback ausgeführt.`,
      );
      return "EXEC_FAIL";
    }

    if (remainingThreads <= 0) return "SUCCESS";
  }

  return remainingThreads === 0 ? "SUCCESS" : "NO_RAM";
}