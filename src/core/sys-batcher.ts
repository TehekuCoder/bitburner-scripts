import { NS, Server } from "@ns";
import { calculateBatch } from "../utils/batch-calculator.js";
import { getAllServers } from "../lib/network.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();

  let batchId = 0;

  ns.print(`🚀 [Batcher] Initialisiert High-End-Dynamic-Batcher...`);

  while (true) {
    // 1. Aktuell freien RAM ermitteln
    const currentFreeNetworkRam = getNetworkFreeRam(ns);
    const totalNetworkCapacity = getNetworkTotalRam(ns);
    const target = findBestBatchTargetForNetwork(ns, totalNetworkCapacity);

    if (!target) {
      ns.print("⚠️ [Batcher] Kein passendes Ziel gefunden. Warte...");
      await ns.sleep(5000);
      continue;
    }

    let greedFactor = 0.04;
    let plan = calculateBatch(ns, target, greedFactor);

    // BEHOBEN: Wir prüfen hier gegen 'currentFreeNetworkRam' statt 'totalNetworkCapacity'
    // Und wir erlauben dem Greed-Factor, bis auf 0.5% (0.005) zu sinken
    while (
      plan &&
      plan.totalRam > currentFreeNetworkRam &&
      greedFactor > 0.005
    ) {
      greedFactor -= 0.005;
      plan = calculateBatch(ns, target, greedFactor);
    }

    if (plan === null || !plan) {
      ns.print(
        `⚠️ [Batcher] ${target} ist nicht im Idealzustand. Warte auf Vorbereitung...`,
      );
      await ns.sleep(5000);
      continue;
    }

    // Wenn selbst bei minimalem Greed der freie RAM nicht reicht, müssen wir echt warten
    if (currentFreeNetworkRam < plan.totalRam) {
      ns.print(
        `⏳ [Batcher] Warteschlange komplett voll für ${target}. Benötigt: ${ns.format.ram(plan.totalRam)} | Frei: ${ns.format.ram(currentFreeNetworkRam)}`,
      );
      await ns.sleep(1000);
      continue;
    }

    ns.print(
      `🔥 [Batcher] Sende Welle #${batchId} -> ${target} (RAM: ${ns.format.ram(plan.totalRam)} | Greed: ${(greedFactor * 100).toFixed(1)}%)`,
    );

    // Die 4 Komponenten im Netzwerk verteilen
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
    await ns.sleep(80); // Pipelining-Spacer
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

    if (server === "home") maxRam = Math.max(0, maxRam - 32);

    const freeRam = maxRam - usedRam;
    const possibleThreads = Math.floor(freeRam / scriptRam);

    if (possibleThreads > 0) {
      const threadsToRun = Math.min(possibleThreads, threadsRemaining);

      if (server !== "home") {
        ns.scp(script, server, "home");
      }

      ns.exec(script, server, threadsToRun, target, delay, id);
      threadsRemaining -= threadsToRun;
      if (threadsRemaining <= 0) break;
    }
  }
}

function getNetworkFreeRam(ns: NS): number {
  return getAllServers(ns)
    .filter((s) => ns.hasRootAccess(s))
    .reduce((total, s) => {
      let max = ns.getServerMaxRam(s);
      if (s === "home") max = Math.max(0, max - 32);
      return total + (max - ns.getServerUsedRam(s));
    }, 0);
}

// NEU: Berechnet die absolute Maximalkapazität des Botnetzes
function getNetworkTotalRam(ns: NS): number {
  return getAllServers(ns)
    .filter((s) => ns.hasRootAccess(s))
    .reduce((total, s) => {
      let max = ns.getServerMaxRam(s);
      if (s === "home") max = Math.max(0, max - 32);
      return total + max;
    }, 0);
}

// BEHOBEN: Validiert das Ziel nun gegen die maximale RAM-Kapazität des Netzwerks
function findBestBatchTargetForNetwork(
  ns: NS,
  maxNetworkRam: number,
): string | null {
  const allServers = getAllServers(ns).filter(
    (s) => ns.hasRootAccess(s) && ns.getServerMaxMoney(s) > 0,
  );
  let bestTarget = null;
  let maxMoney = 0;

  for (const s of allServers) {
    const money = ns.getServerMaxMoney(s);
    if (
      money > maxMoney &&
      ns.getServerRequiredHackingLevel(s) <= ns.getHackingLevel()
    ) {
      // Test-Berechnung mit minimalem Greed-Factor (1%), um zu sehen, ob es überhaupt ins Netz passt
      const testPlan = calculateBatch(ns, s, 0.01);
      if (testPlan && testPlan.totalRam <= maxNetworkRam) {
        maxMoney = money;
        bestTarget = s;
      }
    }
  }
  return bestTarget;
}
