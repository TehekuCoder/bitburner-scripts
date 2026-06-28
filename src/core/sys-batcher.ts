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

  let batchId = 0;
  const SPACER = 80;
  let target: string | null = null;
  let batchesSentForTarget = 0;
  const BATCHES_PER_TARGET = 500;

  ns.print("🚀 [Batcher] Initialisiert High-End-Dynamic-Batcher...");

  while (true) {
    updateServerCache(ns);

    // Ermittle die absolute Obergrenze UND den größten aktuell FREIEN Slot eines Einzleservers
    let maxSingleServerRam = 0;
    let maxSingleServerFreeRam = 0; // 🚀 NEU: Der größte freie Block

    for (const server of cachedServers) {
      if (!ns.hasRootAccess(server)) continue;
      let maxRam = ns.getServerMaxRam(server);
      if (server === "home") maxRam = Math.max(0, maxRam - 64);

      if (maxRam > maxSingleServerRam) {
        maxSingleServerRam = maxRam;
      }

      // Berechne den aktuell freien Speicher dieses Servers
      let freeRam = maxRam - ns.getServerUsedRam(server);
      if (freeRam > maxSingleServerFreeRam) {
        maxSingleServerFreeRam = freeRam;
      }
    }

    // 🔄 JETZT STABIL: Reevaluation prüft nur noch harte Infrastruktur-Limits
    if (
      !target ||
      batchesSentForTarget >= BATCHES_PER_TARGET ||
      batchesSentForTarget === 0
    ) {
      const newTarget = findBestBatchTargetForNetwork(
        ns,
        cachedServers,
        maxSingleServerRam, // Wichtig für atomare Slots
        SPACER,
      );
      if (newTarget) {
        if (newTarget !== target) {
          ns.print(`🎯 [Batcher] Fokussiere neues Primärziel: ${newTarget}`);
          target = newTarget;
          batchesSentForTarget = 0;
        }
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

    // 🚨 INITIAL-PREP & FLUSH
    if (curSec > minSec || curMoney < maxMoney) {
      const currentWeakenTime = ns.getWeakenTime(target);

      if (batchesSentForTarget === 0) {
        ns.print(
          `🔧 [Batcher] ${target} benötigt Prep. Starte kalibrierte Welle...`,
        );
        executePrepPhase(ns, cachedServers, target);
        await ns.sleep(currentWeakenTime + SPACER * 2);
        continue; // Bricht hier ab, batchesSentForTarget bleibt 0, was für Prep-Wellen korrekt ist.
      }

      ns.print(
        `🛑 [Batcher] Desynchronisation auf ${target} erkannt! Flushe Pipeline...`,
      );
      await ns.sleep(currentWeakenTime + SPACER);

      executePrepPhase(ns, cachedServers, target);
      await ns.sleep(ns.getWeakenTime(target) + SPACER * 2);
      continue;
    }

    // Verhindert das Spammen des Logs im Wartemodus
    let lastLogStatus = "";

    // 📈 DYNAMISCHE GIER-BERECHNUNG
    let greedFactor = 0.4;
    let plan = calculateBatch(ns, target, greedFactor, SPACER);

    // 🎯 FIX: Wir drosseln so lange, bis der Batch in den größten aktuell FREIEN Einzelslot passt!
    while (
      plan &&
      plan.totalRam > maxSingleServerFreeRam &&
      greedFactor > 0.01
    ) {
      const lastRam = plan.totalRam;
      greedFactor -= 0.01;
      plan = calculateBatch(ns, target, greedFactor, SPACER);

      // 🛡️ EFFIZIENZ-BREAK: Wenn wir das Thread-Minimum (z.B. 1 Hack-Thread) erreicht haben,
      // sinkt der RAM-Bedarf nicht weiter. Wir brechen ab, um CPU-Zyklen zu sparen.
      if (plan && plan.totalRam === lastRam) {
        break;
      }
    }

    // 📊 INTELLIGENTES LOGGING & WARTE-LOGIK (Anti-Spam-Schutz)
    if (!plan || maxSingleServerFreeRam < plan.totalRam) {
      const requiredRam = plan ? plan.totalRam.toFixed(1) : "???";
      const statusMsg = `WAIT_${target}_${requiredRam}_${maxSingleServerFreeRam.toFixed(1)}`;

      // Zeigt die Warnung NUR an, wenn sich der Status oder die Werte geändert haben!
      if (lastLogStatus !== statusMsg) {
        ns.print(
          `⏳ [Batcher] Infrastruktur ausgelastet. Warte auf Beendigung laufender Wellen für ${target} (Benötigt: ${requiredRam} GB | Größter freier Slot: ${maxSingleServerFreeRam.toFixed(1)} GB)`,
        );
        lastLogStatus = statusMsg;
      }
      await ns.sleep(2000);
      continue;
    }

    // Sobald eine Welle erfolgreich startet, setzen wir den Status zurück
    lastLogStatus = "RUNNING";

    // Dein Log zur Kontrolle (wird jetzt nur noch bei echten Berechnungen ausgegeben)
    ns.print(
      `ℹ️ [Debug] Target: ${target} | Batch-RAM: ${plan.totalRam.toFixed(1)} GB | Größter freier Slot: ${maxSingleServerFreeRam.toFixed(1)} GB`,
    );

    // Atomaren Host für die Ausführung zuweisen (Wird durch den oberen Check garantiert gefunden)
    let batchHost = "";
    for (const server of cachedServers) {
      if (!ns.hasRootAccess(server)) continue;
      let maxRam = ns.getServerMaxRam(server);
      if (server === "home") maxRam = Math.max(0, maxRam - 64);
      if (maxRam - ns.getServerUsedRam(server) >= plan.totalRam) {
        batchHost = server;
        break;
      }
    }

    ns.print(
      `🔥 [Batcher] Welle #${batchId} -> ${target} [Greed: ${(greedFactor * 100).toFixed(1)}% | RAM: ${ns.format.ram(plan.totalRam)} auf ${batchHost}]`,
    );
    const scripts = ["/tasks/hack.js", "/tasks/weaken.js", "/tasks/grow.js"];
    if (batchHost !== "home") {
      ns.scp(scripts, batchHost, "home");
    }

    if (plan.hackThreads > 0)
      ns.exec(
        "/tasks/hack.js",
        batchHost,
        plan.hackThreads,
        target,
        plan.hackDelay,
        batchId,
      );
    if (plan.weaken1Threads > 0)
      ns.exec(
        "/tasks/weaken.js",
        batchHost,
        plan.weaken1Threads,
        target,
        plan.weaken1Delay,
        batchId,
      );
    if (plan.growThreads > 0)
      ns.exec(
        "/tasks/grow.js",
        batchHost,
        plan.growThreads,
        target,
        plan.growDelay,
        batchId,
      );
    if (plan.weaken2Threads > 0)
      ns.exec(
        "/tasks/weaken.js",
        batchHost,
        plan.weaken2Threads,
        target,
        plan.weaken2Delay,
        batchId,
      );

    batchId++;
    batchesSentForTarget++; // Erhöhung findet NUR bei erfolgreichem Hacking-Inflow statt
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
    if (server === "home") maxRam = Math.max(0, maxRam - 64);

    const freeRam = maxRam - ns.getServerUsedRam(server);
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
  if (!ns.formulas || !ns.formulas.hacking) return;

  const minSec = ns.getServerMinSecurityLevel(target);
  const curSec = ns.getServerSecurityLevel(target);
  const maxMoney = ns.getServerMaxMoney(target);
  const curMoney = ns.getServerMoneyAvailable(target);

  const serverMock = ns.getServer(target);
  const player = ns.getPlayer();

  if (curSec > minSec) {
    const secDeficit = curSec - minSec;
    const weakenThreads = Math.ceil(secDeficit / 0.05);
    dispatchBatchScript(
      ns,
      allServers,
      "/tasks/weaken.js",
      weakenThreads,
      target,
      0,
      Date.now(),
    );
  } else if (curMoney < maxMoney) {
    serverMock.hackDifficulty = minSec;
    serverMock.moneyAvailable = Math.max(1, curMoney);

    const growThreads = Math.ceil(
      ns.formulas.hacking.growThreads(serverMock, player, maxMoney),
    );
    const weakenThreadsNeeded = Math.ceil((growThreads * 0.004) / 0.05);

    dispatchBatchScript(
      ns,
      allServers,
      "/tasks/grow.js",
      growThreads,
      target,
      0,
      Date.now(),
    );
    dispatchBatchScript(
      ns,
      allServers,
      "/tasks/weaken.js",
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
  maxSingleServerRam: number,
  spacer: number,
): string | null {
  const targets = allServers.filter(
    (s) => ns.hasRootAccess(s) && ns.getServerMaxMoney(s) > 0,
  );

  let bestTarget = null;
  let highestScore = 0;
  const MAX_ALLOWED_WEAKEN_TIME = 10 * 60 * 1000; // 10 Minuten Max-Limit

  for (const s of targets) {
    if (ns.getServerRequiredHackingLevel(s) > ns.getHackingLevel()) continue;

    // Nutze deinen robusten Calculator unter Idealbedingungen!
    const testPlan = calculateBatch(ns, s, 0.01, spacer);

    // Wenn selbst der kleinste 1%-Batch nicht in deinen größten Server-Slot passt -> Ignorieren
    if (!testPlan || testPlan.totalRam > maxSingleServerRam) continue;

    const idealExecutionTime = testPlan.executionTime;
    if (idealExecutionTime > MAX_ALLOWED_WEAKEN_TIME) continue;

    // Score-Berechnung ist nun 100% statisch und stabil, egal wie leer das Geld aktuell ist!
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
