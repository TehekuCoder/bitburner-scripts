import { NS } from "@ns";
import { calculateBatch } from "../utils/batch-calculator.js";
import { getAllServers } from "../lib/network.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.disableLog("getServerSecurityLevel");
  ns.disableLog("getServerMoneyAvailable");

  let batchId = 0;
  const SPACER = 80; // Taktfrequenz der Pipeline in ms

  // 🔒 TARGET-LOCK MECHANISMUS
  let target: string | null = null;
  let batchesSentForTarget = 0;
  const BATCHES_PER_TARGET = 500; // Hält die Pipeline für mindestens 500 Wellen stabil

  ns.print(`🚀 [Batcher] Initialisiert High-End-Dynamic-Batcher...`);

  while (true) {
    const currentFreeNetworkRam = getNetworkFreeRam(ns);
    const totalNetworkCapacity = getNetworkTotalRam(ns);

    // 1. ZIELWAHL MIT TARGET-LOCK (Verhindert das 41-Minuten-Target-Hopping)
    if (!target || batchesSentForTarget >= BATCHES_PER_TARGET) {
      const newTarget = findBestBatchTargetForNetwork(
        ns,
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
      ns.print(
        "⚠️ [Batcher] Kein passendes oder hackbares Ziel im Netzwerk gefunden. Warte...",
      );
      await ns.sleep(5000);
      continue;
    }

    // 2. AUTOMATISCHE PREP-PHASE
    const minSec = ns.getServerMinSecurityLevel(target);
    const curSec = ns.getServerSecurityLevel(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const curMoney = ns.getServerMoneyAvailable(target);

    if (curSec > minSec || curMoney < maxMoney) {
      const prepTime = ns.getWeakenTime(target);
      ns.print(
        `🔧 [Batcher] ${target} benötigt Vorbereitung. Starte Prep-Welle...`,
      );

      executePrepPhase(ns, target);

      // Schläft nur einmal pro Target-Sperre, anstatt ständig zu springen
      ns.print(
        `⏳ [Batcher] Prep aktiv. Pausiere Batcher für ${ns.format.number(prepTime / 1000, 1)}s`,
      );
      await ns.sleep(prepTime + SPACER * 2);
      continue;
    }

    // 3. DYNAMISCHE GREED-ANPASSUNG (Jetzt mit korrektem SPACER-Übergabewert!)
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

    // 4. PIPELINE-PUFFER-CHECK
    if (!plan || currentFreeNetworkRam < plan.totalRam) {
      await ns.sleep(SPACER);
      continue;
    }

    // 5. DISPATCH DER WELLEN-KOMPONENTEN
    ns.print(
      `🔥 [Batcher] Welle #${batchId} -> ${target} [Greed: ${(greedFactor * 100).toFixed(1)}% | RAM: ${ns.format.ram(plan.totalRam)}]`,
    );

    dispatchBatchScript(
      ns,
      "tasks/hack.js",
      plan.hackThreads,
      target,
      plan.hackDelay,
      batchId,
    );
    dispatchBatchScript(
      ns,
      "tasks/weaken.js",
      plan.weaken1Threads,
      target,
      plan.weaken1Delay,
      batchId,
    );
    dispatchBatchScript(
      ns,
      "tasks/grow.js",
      plan.growThreads,
      target,
      plan.growDelay,
      batchId,
    );
    dispatchBatchScript(
      ns,
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
  script: string,
  threads: number,
  target: string,
  delay: number,
  id: number,
): void {
  if (threads <= 0) return;

  const allServers = getAllServers(ns);
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

function executePrepPhase(ns: NS, target: string): void {
  const minSec = ns.getServerMinSecurityLevel(target);
  const curSec = ns.getServerSecurityLevel(target);
  const maxMoney = ns.getServerMaxMoney(target);
  const curMoney = ns.getServerMoneyAvailable(target);

  if (curSec > minSec) {
    const secDeficit = curSec - minSec;
    const weakenThreads = Math.ceil(secDeficit / 0.05);
    dispatchBatchScript(
      ns,
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
      "tasks/grow.js",
      growThreads,
      target,
      0,
      Date.now(),
    );
    dispatchBatchScript(
      ns,
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
  maxNetworkRam: number,
  spacer: number
): string | null {
  const allServers = getAllServers(ns).filter(
    (s) => ns.hasRootAccess(s) && ns.getServerMaxMoney(s) > 0,
  );

  let bestTarget = null;
  let highestScore = 0;
  
  // 🛡️ TIME-CAP GUARDRAIL: Maximal 10 Minuten Laufzeit erlauben!
  // Alles darüber blockiert den Orchestrator im Early/Mid-Game zu lange.
  const MAX_ALLOWED_WEAKEN_TIME = 10 * 60 * 1000; 

  for (const s of allServers) {
    if (ns.getServerRequiredHackingLevel(s) > ns.getHackingLevel()) continue;

    const weakenTime = ns.getWeakenTime(s);
    if (weakenTime > MAX_ALLOWED_WEAKEN_TIME) continue; // 🛑 Überspringe den Server vorerst!

    const money = ns.getServerMaxMoney(s);
    const score = money / weakenTime;

    if (score > highestScore) {
      const testPlan = calculateBatch(ns, s, 0.01, spacer);
      if (testPlan && testPlan.totalRam <= maxNetworkRam) {
        highestScore = score;
        bestTarget = s;
      }
    }
  }
  return bestTarget;
}
function getNetworkFreeRam(ns: NS): number {
  return getAllServers(ns)
    .filter((s) => ns.hasRootAccess(s))
    .reduce((total, s) => {
      let max = ns.getServerMaxRam(s);
      if (s === "home") max = Math.max(0, max - 64);
      return total + (max - ns.getServerUsedRam(s));
    }, 0);
}

function getNetworkTotalRam(ns: NS): number {
  return getAllServers(ns)
    .filter((s) => ns.hasRootAccess(s))
    .reduce((total, s) => {
      let max = ns.getServerMaxRam(s);
      if (s === "home") max = Math.max(0, max - 64);
      return total + max;
    }, 0);
}
