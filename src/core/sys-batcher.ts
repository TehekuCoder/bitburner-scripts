import { NS } from "@ns";
import { calculateBatch } from "../utils/batch-calculator.js";
import { getAllServers } from "../lib/network.js";
import { patchState } from "./state-manager.js"; // 🚀 NEU: State-Anbindung

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

  let lastLogStatus = "";
  let stallSettleTicks = 0; 
  let currentGreedFactor = 0.4; 
  let lockedPlan: any = null; // 🔒 NEU: Hält den exakten Thread-Plan bombenfest

  ns.print("🚀 [Batcher] Initialisiert High-End-Dynamic-Batcher mit Immutable Plan Lock...");

  while (true) {
    updateServerCache(ns);

    let maxSingleServerRam = 0;
    let maxSingleServerFreeRam = 0;

    for (const server of cachedServers) {
      if (!ns.hasRootAccess(server)) continue;
      let maxRam = ns.getServerMaxRam(server);
      if (server === "home") maxRam = Math.max(0, maxRam - 64);

      if (maxRam > maxSingleServerRam) {
        maxSingleServerRam = maxRam;
      }

      let freeRam = maxRam - ns.getServerUsedRam(server);
      if (freeRam > maxSingleServerFreeRam) {
        maxSingleServerFreeRam = freeRam;
      }
    }

    // 🎯 TARGETING & IMMUTABLE PLAN LOCK
    if (!target || batchesSentForTarget >= BATCHES_PER_TARGET) {
      const newTarget = findBestBatchTargetForNetwork(
        ns,
        cachedServers,
        maxSingleServerRam,
        SPACER,
      );
      
      if (newTarget) {
        ns.print(`🎯 [Batcher] Fokussiere Ziel: ${newTarget}`);
        target = newTarget;
        batchesSentForTarget = 0;

        // Greed-Faktor ermitteln
        currentGreedFactor = 0.4;
        let lockPlan = calculateBatch(ns, target, currentGreedFactor, SPACER);
        while (
          lockPlan &&
          lockPlan.totalRam > maxSingleServerRam &&
          currentGreedFactor > 0.01
        ) {
          currentGreedFactor -= 0.01;
          lockPlan = calculateBatch(ns, target, currentGreedFactor, SPACER);
        }

        // 🔒 PLAN EINFRIEREN: Dieser Plan wird ab jetzt unmodifiziert verwendet!
        lockedPlan = lockPlan;
        
        ns.print(
          `🔒 [Batcher] Architektur für ${target} eingefroren: Greed ${(currentGreedFactor * 100).toFixed(1)}% | RAM: ${lockedPlan ? lockedPlan.totalRam.toFixed(1) : "???"} GB.`,
        );
      } else {
        target = null;
        lockedPlan = null;
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

    const isMassiveDesync = curSec > minSec + 1 || curMoney < maxMoney * 0.85;
    const needsInitialPrep =
      batchesSentForTarget === 0 && (curSec > minSec || curMoney < maxMoney);

    if (needsInitialPrep || isMassiveDesync) {
      const currentWeakenTime = ns.getWeakenTime(target);
      
      // Bei Desynchronisation werfen wir den alten Plan weg, da sich Serverdaten geändert haben könnten
      lockedPlan = null; 

      if (batchesSentForTarget === 0) {
        ns.print(`🔧 [Batcher] ${target} benötigt Prep. Starte kalibrierte Welle...`);
        executePrepPhase(ns, cachedServers, target);
        await ns.sleep(currentWeakenTime + SPACER * 2);
        continue;
      }

      ns.print(
        `🛑 [Batcher] Harte Desynchronisation auf ${target} erkannt (Sec: ${curSec.toFixed(1)}/${minSec}, Money: ${ns.format.percent(curMoney / maxMoney)})! Flushe Pipeline...`,
      );
      await ns.sleep(currentWeakenTime + SPACER);

      executePrepPhase(ns, cachedServers, target);
      await ns.sleep(ns.getWeakenTime(target) + SPACER * 2);
      continue;
    }

    // Wenn aus irgendeinem Grund kein Plan existiert, generieren wir einen Sicherheits-Fallback
    if (!lockedPlan) {
      lockedPlan = calculateBatch(ns, target, currentGreedFactor, SPACER);
    }

    let plan = lockedPlan;

    if (plan) {
      patchState(ns, { batcherRamNeeded: plan.totalRam });
    }

    // RAM-Check gegen den absolut statischen Plan
    if (!plan || maxSingleServerFreeRam < plan.totalRam) {
      const requiredRam = plan ? plan.totalRam.toFixed(1) : "???";
      const statusMsg = `WAIT_${target}_${requiredRam}_${maxSingleServerFreeRam.toFixed(1)}`;

      if (lastLogStatus !== statusMsg) {
        ns.print(
          `⏳ [Batcher] Infrastruktur ausgelastet. Warte auf RAM für ${target} (Benötigt: ${requiredRam} GB | Frei: ${maxSingleServerFreeRam.toFixed(1)} GB)`,
        );
        lastLogStatus = statusMsg;
      }

      await ns.sleep(SPACER);
      continue;
    }

    // 🛡️ GATEKEEPER
    if (lastLogStatus.startsWith("WAIT_")) {
      const freshSec = ns.getServerSecurityLevel(target);
      const freshMoney = ns.getServerMoneyAvailable(target);

      if (freshSec > minSec || freshMoney < maxMoney) {
        stallSettleTicks++;

        if (stallSettleTicks > 25) {
          ns.print(`⚠️ [Batcher] ${target} stabilisiert sich nicht von allein. Erzwinge Prep-Phase...`);
          batchesSentForTarget = 0; 
          stallSettleTicks = 0;
          lockedPlan = null;
          await ns.sleep(SPACER);
          continue;
        }

        ns.print(
          `⏳ [Batcher] RAM bereit! Warte auf das Auslaufen alter Wellen (Settle: ${stallSettleTicks}/25 | Sec: ${freshSec.toFixed(2)}/${minSec})`,
        );
        await ns.sleep(SPACER);
        continue; 
      }
    }

    stallSettleTicks = 0;
    lastLogStatus = "RUNNING";

    ns.print(
      `ℹ️ [Debug] Target: ${target} | Batch-RAM: ${plan.totalRam.toFixed(1)} GB | Größter freier Slot: ${maxSingleServerFreeRam.toFixed(1)} GB`,
    );

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
      `🔥 [Batcher] Welle #${batchId} -> ${target} [Greed: ${(currentGreedFactor * 100).toFixed(1)}% | RAM: ${ns.format.ram(plan.totalRam)} auf ${batchHost}]`,
    );
    const scripts = ["/tasks/hack.js", "/tasks/weaken.js", "/tasks/grow.js"];
    if (batchHost !== "home") {
      ns.scp(scripts, batchHost, "home");
    }

    if (plan.hackThreads > 0)
      ns.exec("/tasks/hack.js", batchHost, plan.hackThreads, target, plan.hackDelay, batchId);
    if (plan.weaken1Threads > 0)
      ns.exec("/tasks/weaken.js", batchHost, plan.weaken1Threads, target, plan.weaken1Delay, batchId);
    if (plan.growThreads > 0)
      ns.exec("/tasks/grow.js", batchHost, plan.growThreads, target, plan.growDelay, batchId);
    if (plan.weaken2Threads > 0)
      ns.exec("/tasks/weaken.js", batchHost, plan.weaken2Threads, target, plan.weaken2Delay, batchId);

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

  // 🌟 DYNAMISCHES ZEIT-LIMIT 🌟
  // Basis: 10 Minuten.
  // Skalierung: Für je 100 Hacking-Level erlauben wir 2 zusätzliche Minuten.
  const playerHackLevel = ns.getHackingLevel();
  const maxAllowedWeakenMinutes = 10 + (playerHackLevel / 100) * 2;
  const DYNAMIC_MAX_WEAKEN_TIME = maxAllowedWeakenMinutes * 60 * 1000;

  for (const s of targets) {
    if (ns.getServerRequiredHackingLevel(s) > playerHackLevel) continue;

    // Nutze deinen robusten Calculator unter Idealbedingungen!
    const testPlan = calculateBatch(ns, s, 0.01, spacer);

    // Wenn selbst der kleinste 1%-Batch nicht in deinen größten Server-Slot passt -> Ignorieren
    if (!testPlan || testPlan.totalRam > maxSingleServerRam) continue;

    const idealExecutionTime = testPlan.executionTime;

    // 🚀 Nutze das neue dynamische Limit anstelle der statischen 10 Minuten
    if (idealExecutionTime > DYNAMIC_MAX_WEAKEN_TIME) continue;

    // Score-Berechnung ist 100% statisch und stabil, egal wie leer das Geld aktuell ist!
    const money = ns.getServerMaxMoney(s);
    const score = money / idealExecutionTime;

    if (score > highestScore) {
      highestScore = score;
      bestTarget = s;
    }
  }
  return bestTarget;
}
