import { NS, Server } from "@ns";
import { calculateBatch } from "../utils/batch-calculator.js";
import { getAllServers } from "../lib/network.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  // Dynamische Zielwahl: Sucht sich den lukrativsten Server, den wir hacken können
  const target = findBestBatchTarget(ns);
  let batchId = 0; // Eindeutige ID, damit Skripte parallel auf demselben Server laufen dürfen

  ns.print(`🚀 [Batcher] Initialisiert für High-End-Grind auf: ${target}`);

  while (true) {
    // FIX 1: Greed-Factor festlegen (z.B. 4% des Geldes pro Welle stehlen)
    const greedFactor = 0.04;
    const plan = calculateBatch(ns, target, greedFactor);

    if (plan === null || !plan) {
      ns.print(
        `⚠️ [Batcher] ${target} ist nicht im Idealzustand. Warte auf Vorbereitung...`,
      );
      await ns.sleep(5000);
      continue;
    }

    // Prüfen, ob das Netzwerk aktuell genug RAM für diese Welle hat
    const currentFreeNetworkRam = getNetworkFreeRam(ns);
    if (currentFreeNetworkRam < plan.totalRam) {
      ns.print(
        `⏳ [Batcher] Warteschlange voll. Benötigt: ${ns.format.ram(plan.totalRam)} | Frei: ${ns.format.ram(currentFreeNetworkRam)}`,
      );
      await ns.sleep(1000); // Warten, bis alte Batches fertig sind
      continue;
    }

    ns.print(
      `🔥 [Batcher] Sende Batchwelle #${batchId} gegen ${target} (RAM: ${ns.format.ram(plan.totalRam)})`,
    );

    // FIX 2: Die 4 exakt getimten Wellen-Komponenten im Netzwerk verteilen
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
    ); // Weaken 2 fängt die Grow-Sicherheit ab

    batchId++;

    // PIPELINING: Ein Spacer von 4 * 20ms = 80ms erlaubt es uns,
    // hunderte Batches versetzt "in die Luft" zu werfen, bevor der erste überhaupt einschlägt!
    await ns.sleep(80);
  }
}

/**
 * Verteilt die Threads eines Skripts dynamisch auf alle verfügbaren Server im Botnetz.
 */
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

    // Sicherheits-Puffer auf 'home' lassen, damit das OS nicht einfriert
    if (server === "home") maxRam = Math.max(0, maxRam - 32);

    const freeRam = maxRam - usedRam;
    const possibleThreads = Math.floor(freeRam / scriptRam);

    if (possibleThreads > 0) {
      const threadsToRun = Math.min(possibleThreads, threadsRemaining);

      if (server !== "home") {
        ns.scp(script, server, "home");
      }

      // WICHTIG: args[0]=Target, args[1]=Delay, args[2]=BatchID (macht den Aufruf im OS eindeutig)
      ns.exec(script, server, threadsToRun, target, delay, id);

      threadsRemaining -= threadsToRun;
      if (threadsRemaining <= 0) break;
    }
  }
}

/**
 * Berechnet den gesamten freien RAM des Netzwerks
 */
function getNetworkFreeRam(ns: NS): number {
  return getAllServers(ns)
    .filter((s) => ns.hasRootAccess(s))
    .reduce((total, s) => {
      let max = ns.getServerMaxRam(s);
      if (s === "home") max = Math.max(0, max - 32);
      return total + (max - ns.getServerUsedRam(s));
    }, 0);
}

/**
 * Sucht das rentabelste Ziel für das Formulas-basierte Batching
 */
function findBestBatchTarget(ns: NS): string {
  const allServers = getAllServers(ns).filter(
    (s) => ns.hasRootAccess(s) && ns.getServerMaxMoney(s) > 0,
  );
  let bestTarget = "n00dles";
  let maxMoney = 0;

  for (const s of allServers) {
    const money = ns.getServerMaxMoney(s);
    if (
      money > maxMoney &&
      ns.getServerRequiredHackingLevel(s) <= ns.getHackingLevel()
    ) {
      maxMoney = money;
      bestTarget = s;
    }
  }
  return bestTarget;
}
