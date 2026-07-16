import { NS } from "@ns";
// Wir gehen eine Ebene hoch (aus /tasks/) und in /utils/ rein:
import { calculateBatch, BatchPlan } from "../utils/batch-calculator.js";
// Wir gehen eine Ebene hoch (aus /tasks/) und in /lib/ rein:
import { loadBnMults } from "../lib/state.js";

const SPACER = 100;
const GREED_FACTOR = 0.05;

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const target = ns.args[0] as string || "n00dles";
  const bnMults = loadBnMults(ns);

  ns.ui.openTail();
  ns.print(`🚀 Starte Proto-Batcher auf Ziel: ${target}`);

  while (true) {
    // 1. Server-Vorbereitung (falls er nicht auf Min Sec / Max Money ist)
    const secDiff = ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target);
    const moneyPercent = ns.getServerMoneyAvailable(target) / ns.getServerMaxMoney(target);

    if (secDiff > 0 || moneyPercent < 1.0) {
      ns.print("⚠️ Server nicht im Idealzustand. Starte Vorbereitung...");
      // Hier könntest du ein kurzes Grow/Weaken-Skript vorschalten
      await prepServer(ns, target);
      continue;
    }

    // 2. Perfekten Batch für genau EINE Welle berechnen
    const plan = calculateBatch(ns, target, bnMults, GREED_FACTOR, SPACER) as BatchPlan | null;

    if (!plan) {
      ns.print("❌ Konnte keinen gültigen Batch-Plan erstellen. Warte 5 Sekunden...");
      await ns.sleep(5000);
      continue;
    }

    // 3. Batch ausführen
    ns.print(`🔥 Feuere Batch ab: H:${plan.hackThreads} W1:${plan.weaken1Threads} G:${plan.growThreads} W2:${plan.weaken2Threads}`);
    
    // Starte die Skripte auf home (oder dem lohnendsten Server)
    const host = "home";
    
    if (plan.hackThreads > 0) {
      ns.exec("dep/hack.js", host, plan.hackThreads, target, plan.hackDelay, Math.random());
    }
    if (plan.weaken1Threads > 0) {
      ns.exec("dep/weaken.js", host, plan.weaken1Threads, target, plan.weaken1Delay, Math.random());
    }
    if (plan.growThreads > 0) {
      ns.exec("dep/grow.js", host, plan.growThreads, target, plan.growDelay, Math.random());
    }
    if (plan.weaken2Threads > 0) {
      ns.exec("dep/weaken.js", host, plan.weaken2Threads, target, plan.weaken2Delay, Math.random());
    }

    // 4. Die "Sicherheits-Pause"
    // Wir warten, bis das allerletzte Weaken-Skript garantiert fertig ist, plus Puffer
    const waitTime = plan.executionTime + (SPACER * 2);
    ns.print(`😴 Batch läuft. Schlafe für ${(waitTime / 1000).toFixed(1)}s...`);
    await ns.sleep(waitTime);
  }
}

async function prepServer(ns: NS, target: string): Promise<void> {
  const minSec = ns.getServerMinSecurityLevel(target);
  const maxMoney = ns.getServerMaxMoney(target);

  while (ns.getServerSecurityLevel(target) > minSec) {
    const weakenTime = ns.getWeakenTime(target);
    ns.exec("dep/weaken.js", "home", 10, target, 0, Math.random());
    await ns.sleep(weakenTime + 100);
  }

  while (ns.getServerMoneyAvailable(target) < maxMoney) {
    const growTime = ns.getGrowTime(target);
    ns.exec("dep/grow.js", "home", 10, target, 0, Math.random());
    ns.exec("dep/weaken.js", "home", 2, target, 0, Math.random());
    await ns.sleep(growTime + 100);
  }
}