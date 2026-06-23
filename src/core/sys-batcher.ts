import { NS } from "@ns";
import { calculateBatch } from "../utils/batch-calculator.js";
import { getAllServers } from "../lib/network.js";

let cachedServers: string[] = [];
let lastCacheUpdate = 0;

function updateServerCache(ns: NS): void {
  const now = Date.now();
  if (now - lastCacheUpdate > 2000 || cachedServers.length === 0) {
    cachedServers = getAllServers(ns).sort(
      (a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a),
    );
    lastCacheUpdate = now;
  }
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.disableLog("getServerSecurityLevel");
  ns.disableLog("getServerMoneyAvailable");

  let batchId = 0;
  const SPACER = 80;

  let target: string | null = null;
  let batchesSentForTarget = 0;
  const BATCHES_PER_TARGET = 500;

  ns.print(`🚀 [Batcher] Initialisiert High-End-Dynamic-Batcher...`);

  while (true) {
    updateServerCache(ns);

    const currentFreeNetworkRam = getNetworkFreeRam(ns, cachedServers);
    const totalNetworkCapacity = getNetworkTotalRam(ns, cachedServers);

    if (!target || batchesSentForTarget >= BATCHES_PER_TARGET) {
      const newTarget = findBestBatchTargetForNetwork(
        ns,
        cachedServers,
        totalNetworkCapacity,
        SPACER,
      );
      if (newTarget) {
        if (newTarget !== target) {
          ns.print(`🎯 [Batcher] Fokussiere neues Primärziel: ${newTarget}`);
          target = newTarget;
        }
        batchesSentForTarget = 0;
      }
    }

    if (!target) {
      ns.print("⚠️ [Batcher] Kein passendes Ziel gefunden. Warte...");
      await ns.sleep(5000);
      continue;
    }

    const minSec = ns.getServerMinSecurityLevel(target);
    const curSec = ns.getServerSecurityLevel(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const curMoney = ns.getServerMoneyAvailable(target);

    // 🚨 PIPELINE-FLUSH ODER INITIAL-PREP
    if (curSec > minSec || curMoney < maxMoney) {
      const currentWeakenTime = ns.getWeakenTime(target);

      // 🔥 AUSNAHME: Wenn noch keine Wellen gesendet wurden, fliegen auch keine Geister!
      if (batchesSentForTarget === 0) {
        ns.print(
          `🔧 [Batcher] ${target} benötigt Initial-Prep. Überspringe Flush-Wartezeit...`,
        );
        executePrepPhase(ns, cachedServers, target);

        // Warte exakt auf das Einschlagen der Prep-Welle
        await ns.sleep(currentWeakenTime + SPACER * 2);
        continue;
      }

      // ECHTER FLUSH (Nur wenn vorher schon Wellen aktiv waren)
      ns.print(`🛑 [Batcher] Desynchronisation auf ${target} erkannt!`);
      ns.print(
        `🌌 Flushe Pipeline... Warte ${ns.format.number(currentWeakenTime / 1000, 1)}s auf fliegende Geister-Wellen.`,
      );

      // 1. Lass alle aktuell aktiven Scripte ungehindert einschlagen
      await ns.sleep(currentWeakenTime + SPACER);

      // 2. Jetzt, wo der Server im absoluten Stillstand ist, messen wir neu
      const freshPrepTime = ns.getWeakenTime(target);
      ns.print(
        `🔧 [Batcher] Pipeline sauber. Starte kalibrierte Prep-Welle...`,
      );
      executePrepPhase(ns, cachedServers, target);

      // 3. Warte auf die Prep-Welle
      await ns.sleep(freshPrepTime + SPACER * 2);
      continue;
    }

    let greedFactor = 0.04;
    let plan = calculateBatch(ns, target, greedFactor, SPACER);

    while (
      plan &&
      plan.totalRam > currentFreeNetworkRam &&
      greedFactor > 0.005
    ) {
      greedFactor -= 0.005;
      plan = calculateBatch(ns, target, greedFactor, SPACER);
    }

    if (!plan || currentFreeNetworkRam < plan.totalRam) {
      await ns.sleep(SPACER);
      continue;
    }

    ns.print(
      `🔥 [Batcher] Welle #${batchId} -> ${target} [Greed: ${(greedFactor * 100).toFixed(1)}% | RAM: ${ns.format.ram(plan.totalRam)}]`,
    );

    dispatchBatchScript(
      ns,
      cachedServers,
      "tasks/hack.js",
      plan.hackThreads,
      target,
      plan.hackDelay,
      batchId,
    );
    dispatchBatchScript(
      ns,
      cachedServers,
      "tasks/weaken.js",
      plan.weaken1Threads,
      target,
      plan.weaken1Delay,
      batchId,
    );
    dispatchBatchScript(
      ns,
      cachedServers,
      "tasks/grow.js",
      plan.growThreads,
      target,
      plan.growDelay,
      batchId,
    );
    dispatchBatchScript(
      ns,
      cachedServers,
      "tasks/weaken.js",
      plan.weaken2Threads,
      target,
      plan.weaken2Delay,
      batchId,
    );

    batchId++;
    batchesSentForTarget++;
    await ns.sleep(SPACER);
  }
}

function dispatchBatchScript(
  ns: NS,
  allServers: string[],
  script: string,
  threads: number,
  target: string,
  delay: number,
  id: number,
): void {
  if (threads <= 0) return;

  const scriptRam = ns.getScriptRam(script);
  let threadsRemaining = threads;

  for (const server of allServers) {
    if (!ns.hasRootAccess(server)) continue;

    let maxRam = ns.getServerMaxRam(server);
    let usedRam = ns.getServerUsedRam(server);
    if (server === "home") maxRam = Math.max(0, maxRam - 64);

    const freeRam = maxRam - usedRam;
    const possibleThreads = Math.floor(freeRam / scriptRam);

    if (possibleThreads > 0) {
      const threadsToRun = Math.min(possibleThreads, threadsRemaining);

      if (server !== "home" && !ns.fileExists(script, server)) {
        ns.scp(script, server, "home");
      }

      ns.exec(script, server, threadsToRun, target, delay, id);
      threadsRemaining -= threadsToRun;
      if (threadsRemaining <= 0) break;
    }
  }
}

function executePrepPhase(ns: NS, allServers: string[], target: string): void {
  const minSec = ns.getServerMinSecurityLevel(target);
  const curSec = ns.getServerSecurityLevel(target);
  const maxMoney = ns.getServerMaxMoney(target);
  const curMoney = ns.getServerMoneyAvailable(target);

  if (curSec > minSec) {
    const secDeficit = curSec - minSec;
    const weakenThreads = Math.ceil(secDeficit / 0.05);
    dispatchBatchScript(
      ns,
      allServers,
      "tasks/weaken.js",
      weakenThreads,
      target,
      0,
      Date.now(),
    );
  } else if (curMoney < maxMoney) {
    const growThreads = Math.ceil(
      ns.growthAnalyze(target, maxMoney / Math.max(1, curMoney)),
    );
    const weakenThreadsNeeded = Math.ceil((growThreads * 0.004) / 0.05);

    dispatchBatchScript(
      ns,
      allServers,
      "tasks/grow.js",
      growThreads,
      target,
      0,
      Date.now(),
    );
    dispatchBatchScript(
      ns,
      allServers,
      "tasks/weaken.js",
      weakenThreadsNeeded,
      target,
      50,
      Date.now(),
    );
  }
}

function findBestBatchTargetForNetwork(
  ns: NS,
  allServers: string[],
  maxNetworkRam: number,
  spacer: number,
): string | null {
  const targets = allServers.filter(
    (s) => ns.hasRootAccess(s) && ns.getServerMaxMoney(s) > 0,
  );

  let bestTarget = null;
  let highestScore = 0;
  const MAX_ALLOWED_WEAKEN_TIME = 10 * 60 * 1000;

  for (const s of targets) {
    if (ns.getServerRequiredHackingLevel(s) > ns.getHackingLevel()) continue;

    // 🔥 FIX 1: Wir berechnen ERST den Test-Plan unter Idealbedingungen!
    const testPlan = calculateBatch(ns, s, 0.01, spacer);
    if (!testPlan || testPlan.totalRam > maxNetworkRam) continue;

    // 🔥 FIX 2: Wir nutzen die IDEALE Laufzeit (tW + spacer * 2) für den Score,
    // nicht die aktuelle, durch hohe Security künstlich aufgeblähte Zeit!
    const idealExecutionTime = testPlan.executionTime;
    if (idealExecutionTime > MAX_ALLOWED_WEAKEN_TIME) continue;

    const money = ns.getServerMaxMoney(s);
    const score = money / idealExecutionTime;

    if (score > highestScore) {
      highestScore = score;
      bestTarget = s;
    }
  }
  return bestTarget;
}
function getNetworkFreeRam(ns: NS, allServers: string[]): number {
  return allServers
    .filter((s) => ns.hasRootAccess(s))
    .reduce((total, s) => {
      let max = ns.getServerMaxRam(s);
      if (s === "home") max = Math.max(0, max - 64);
      return total + (max - ns.getServerUsedRam(s));
    }, 0);
}

function getNetworkTotalRam(ns: NS, allServers: string[]): number {
  return allServers
    .filter((s) => ns.hasRootAccess(s))
    .reduce((total, s) => {
      let max = ns.getServerMaxRam(s);
      if (s === "home") max = Math.max(0, max - 64);
      return total + max;
    }, 0);
}
