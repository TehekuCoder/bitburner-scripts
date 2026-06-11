import { NS, Server } from "@ns";
import { calculateBatch } from "../utils/batch-calculator.js";
import { getAllServers } from "../lib/network.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  // ns.ui.openTail();

  let batchId = 0;
  const SPACER = 80; // Taktfrequenz der Pipeline in ms

  ns.print(`🚀 [Batcher] Initialisiert High-End-Dynamic-Batcher...`);

  while (true) {
    const currentFreeNetworkRam = getNetworkFreeRam(ns);
    const totalNetworkCapacity = getNetworkTotalRam(ns);

    // 1. ZIELWAHL NACH EFFIZIENZ (Geld pro Sekunde)
    const target = findBestBatchTargetForNetwork(ns, totalNetworkCapacity);

    if (!target) {
      ns.print(
        "⚠️ [Batcher] Kein passendes oder hackbares Ziel im Netzwerk gefunden. Warte...",
      );
      await ns.sleep(5000);
      continue;
    }

    // 2. AUTOMATISCHE PREP-PHASE (Falls nicht im Idealzustand)
    const minSec = ns.getServerMinSecurityLevel(target);
    const curSec = ns.getServerSecurityLevel(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const curMoney = ns.getServerMoneyAvailable(target);

    if (curSec > minSec || curMoney < maxMoney) {
      ns.print(
        `🔧 [Batcher] ${target} benötigt Vorbereitung. Starte Prep-Welle...`,
      );
      executePrepPhase(ns, target);
      await ns.sleep(SPACER * 10); // Kurze Pause, um die Server nicht zu fluten
      continue;
    }

    // 3. DYNAMISCHE GREED-ANPASSUNG
    let greedFactor = 0.04; // Start bei 4% Diebstahl pro Welle
    let plan = calculateBatch(ns, target, greedFactor);

    while (
      plan &&
      plan.totalRam > currentFreeNetworkRam &&
      greedFactor > 0.005
    ) {
      greedFactor -= 0.005;
      plan = calculateBatch(ns, target, greedFactor);
    }

    // 4. PIPELINE-PUFFER-CHECK (Taktsynchron halten!)
    if (!plan || currentFreeNetworkRam < plan.totalRam) {
      // WICHTIG: Niemals 1000ms schlafen! Wir schlafen exakt einen Takt (SPACER).
      // Dadurch bleibt die Pipeline im Rhythmus und greift sofort zu, sobald RAM frei wird.
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
    if (server === "home") maxRam = Math.max(0, maxRam - 64); // Erhöhter Schutz für OS/Dispatcher

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

function executePrepPhase(ns: NS, target: string): void {
  // Simpler, aber robuster Prep-Algorithmus: Weaken bricht Security, Grow zieht Geld nach
  const minSec = ns.getServerMinSecurityLevel(target);
  const curSec = ns.getServerSecurityLevel(target);
  const maxMoney = ns.getServerMaxMoney(target);
  const curMoney = ns.getServerMoneyAvailable(target);

  if (curSec > minSec) {
    // Wenn Security zu hoch ist: Pures Weaken!
    const secDeficit = curSec - minSec;
    const weakenThreads = Math.ceil(secDeficit / 0.05); // Ein Weaken-Thread senkt Sec um 0.05
    dispatchBatchScript(
      ns,
      "tasks/weaken.js",
      weakenThreads,
      target,
      0,
      Date.now(),
    );
  } else if (curMoney < maxMoney) {
    // Wenn Security perfekt, aber Geld fehlt: Grow & passendes Weaken triggern
    const growThreads = Math.ceil(
      ns.growthAnalyze(target, maxMoney / Math.max(1, curMoney)),
    );
    const weakenThreadsNeeded = Math.ceil((growThreads * 0.004) / 0.05); // Grow erhöht Sec um 0.004

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
    ); // Leicht verzögert dahinter
  }
}

function findBestBatchTargetForNetwork(
  ns: NS,
  maxNetworkRam: number,
): string | null {
  const allServers = getAllServers(ns).filter(
    (s) => ns.hasRootAccess(s) && ns.getServerMaxMoney(s) > 0,
  );

  let bestTarget = null;
  let highestScore = 0;

  for (const s of allServers) {
    if (ns.getServerRequiredHackingLevel(s) > ns.getHackingLevel()) continue;

    // EFFIZIENZ-SCORE: Geld dividiert durch die Zeit, die ein Weaken benötigt
    const money = ns.getServerMaxMoney(s);
    const weakenTime = ns.getWeakenTime(s);
    const score = money / weakenTime;

    if (score > highestScore) {
      // Gegenprüfen, ob die Kiste überhaupt mit Minimal-Greed ins Netz passt
      const testPlan = calculateBatch(ns, s, 0.01);
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
