import { NS } from "@ns";
import { calculateBatch } from "../utils/batch-calculator.js";
import { getAllServers } from "../lib/network.js";
import { patchState } from "./state-manager.js";
import { loadBnMults } from "../lib/state.js";

interface DashboardData {
  status: string;
  target: string;
  progress: number;
  progressText: string;
  greed: number;
  ramNeeded: number;
  ramFree: number;
  ramTotal: number;
  batchesSent: number;
  batchesMax: number;
  eventLog: string[];
  lastWaveProfit: number;
}

let cachedServers: string[] = [];
let lastCacheUpdate = 0;
let lastUiUpdate = 0;
const eventLog: string[] = [];

function updateServerCache(ns: NS): void {
  const now = Date.now();
  if (now - lastCacheUpdate > 2000 || cachedServers.length === 0) {
    cachedServers = getAllServers(ns).sort(
      (a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a),
    );
    lastCacheUpdate = now;
  }
}

function logEvent(msg: string): void {
  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  eventLog.push(`[${time}] ${msg}`);
  if (eventLog.length > 4) eventLog.shift();
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();

  const bnMults = loadBnMults(ns);

  if (
    (bnMults.ScriptHackMoneyGain ?? 1) === 0 ||
    (bnMults.ServerMaxMoney ?? 1) === 0
  ) {
    logEvent("🛑 Hacking wirft hier kein Geld ab. Batcher deaktiviert.");
    return;
  }

  let batchId = 0;
  const SPACER = 80;
  let target: string | null = null;
  let batchesSentForTarget = 0;

  // 💡 ANPASSUNG 1: Aus der Konstante wird eine dynamische Obergrenze
  let dynamicMaxBatchesForTarget = 500;

  let lastLogStatus = "";
  let stallSettleTicks = 0;
  let currentGreedFactor = 0.4;
  let lockedPlan: any = null;
  let lastWaveProfit = 0;

  const SCRIPT_RAM_BASE = 1.75;

  logEvent("System initialisiert. Warte auf Netzwerk-Pool...");

  while (true) {
    updateServerCache(ns);

    let totalUsableMaxRam = 0;
    let totalUsableFreeRam = 0;

    for (const server of cachedServers) {
      if (!ns.hasRootAccess(server)) continue;
      let maxRam = ns.getServerMaxRam(server);
      if (server === "home") maxRam = Math.max(0, maxRam - 64);

      const usedRam = ns.getServerUsedRam(server);
      const freeRam = Math.max(0, maxRam - usedRam);

      totalUsableMaxRam +=
        Math.floor(maxRam / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;
      totalUsableFreeRam +=
        Math.floor(freeRam / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;
    }

    // 🎯 TARGETING & PIPELINE-AWARE PLAN LOCK
    if (!target || batchesSentForTarget >= dynamicMaxBatchesForTarget) {
      const newTarget = findBestBatchTargetForNetwork(
        ns,
        cachedServers,
        totalUsableMaxRam,
        SPACER,
        bnMults,
      );

      if (newTarget) {
        target = newTarget;
        batchesSentForTarget = 0;

        // 💡 ANPASSUNG 2: Berechne die Pipeline-Kapazität im Zeitfenster
        const serverMock = ns.getServer(target);
        serverMock.hackDifficulty = serverMock.minDifficulty;
        const weakenTime = ns.formulas!.hacking.weakenTime(
          serverMock,
          ns.getPlayer(),
        );

        // Wie viele Wellen fliegen gleichzeitig?
        const maxConcurrentBatches = Math.max(
          1,
          Math.floor(weakenTime / SPACER),
        );

        // Der ideale RAM-Verbrauch pro Welle, um den PB-Pool exakt linear zu füllen
        const idealBatchRam = totalUsableMaxRam / maxConcurrentBatches;

        // Rotation dynamisch anpassen: Wir wollen mindestens 2 volle Pipeline-Durchläufe auf dem Ziel bleiben
        dynamicMaxBatchesForTarget = Math.max(500, maxConcurrentBatches * 2);

        // Starte die Gier-Suche hoch (90%), um den Slot perfekt auszureizen
        currentGreedFactor = 0.9;
        let lockPlan = calculateBatch(
          ns,
          target,
          bnMults,
          currentGreedFactor,
          SPACER,
        );

        // 💡 ANPASSUNG 3: Gier herunterstufen, bis der Batch in seinen ZEIT-SLOT passt, nicht in den Gesamt-RAM!
        while (
          (lockPlan === null || lockPlan.totalRam > idealBatchRam) &&
          currentGreedFactor > 0.01
        ) {
          currentGreedFactor -= 0.01;
          lockPlan = calculateBatch(
            ns,
            target,
            bnMults,
            currentGreedFactor,
            SPACER,
          );
        }

        // Failsafe: Falls der Slot kleiner ist als ein 1%-Batch (z.B. im Early-Game),
        // nutze das Maximum, was physisch in den Gesamt-RAM passt.
        if (!lockPlan || lockPlan.totalRam > totalUsableMaxRam) {
          currentGreedFactor = 0.4;
          lockPlan = calculateBatch(
            ns,
            target,
            bnMults,
            currentGreedFactor,
            SPACER,
          );
          while (
            (lockPlan === null || lockPlan.totalRam > totalUsableMaxRam) &&
            currentGreedFactor > 0.01
          ) {
            currentGreedFactor -= 0.01;
            lockPlan = calculateBatch(
              ns,
              target,
              bnMults,
              currentGreedFactor,
              SPACER,
            );
          }
        }

        if (lockPlan) {
          lockedPlan = lockPlan;
          logEvent(
            `🔒 Pipeline-Plan fixiert: Greed ${(currentGreedFactor * 100).toFixed(1)}% | Erhoffte Gleichzeitigkeit: ${maxConcurrentBatches} Wellen`,
          );
        } else {
          logEvent(`⚠️ Ziel ${target} zu komplex. Suche neues Ziel...`);
          target = null;
          await ns.sleep(1000);
          continue;
        }
      } else {
        target = null;
        lockedPlan = null;
      }
    }

    if (!target) {
      if (Date.now() - lastUiUpdate > 250) {
        drawBatcherDashboard(ns, {
          status: "SUCHE ZIEL",
          target: "Keines",
          progress: 0,
          progressText: "Scanne Netzwerk nach profitablen Zielen...",
          greed: 0,
          ramNeeded: 0,
          ramFree: totalUsableFreeRam,
          ramTotal: totalUsableMaxRam,
          batchesSent: 0,
          batchesMax: dynamicMaxBatchesForTarget,
          eventLog,
          lastWaveProfit,
        });
        lastUiUpdate = Date.now();
      }
      await ns.sleep(1000);
      continue;
    }

    const minSec = ns.getServerMinSecurityLevel(target);
    const curSec = ns.getServerSecurityLevel(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const curMoney = ns.getServerMoneyAvailable(target);

    const isMassiveDesync = curSec > minSec + 1 || curMoney < maxMoney * 0.85;
    const needsInitialPrep =
      batchesSentForTarget === 0 && (curSec > minSec || curMoney < maxMoney);

    // --- 🔧 PREP-PHASE ---
    if (needsInitialPrep || isMassiveDesync) {
      const currentWeakenTime = ns.getWeakenTime(target);
      lockedPlan = null;
      patchState(ns, { batcherTarget: target });

      if (batchesSentForTarget === 0) {
        logEvent(`🔧 Kalibrierte Prep-Welle abgefeuert.`);
        executePrepPhase(ns, cachedServers, target, bnMults);
      } else {
        logEvent(`🛑 Desync! Pipeline geflusht & Recovery eingeleitet.`);
        await ns.sleep(SPACER * 10);
        executePrepPhase(ns, cachedServers, target, bnMults);
      }

      const prepDuration = currentWeakenTime + SPACER * 2;
      const prepStartedAt = Date.now();

      while (Date.now() - prepStartedAt < prepDuration) {
        const elapsed = Date.now() - prepStartedAt;
        const progress = Math.min(1, elapsed / prepDuration);
        const secsLeft = Math.max(0, (prepDuration - elapsed) / 1000);

        let tRam = 0;
        let tFree = 0;
        for (const s of cachedServers) {
          if (!ns.hasRootAccess(s)) continue;
          let mRam = ns.getServerMaxRam(s);
          if (s === "home") mRam = Math.max(0, mRam - 64);
          const uRam = ns.getServerUsedRam(s);
          tRam += Math.floor(mRam / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;
          tFree +=
            Math.floor((mRam - uRam) / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;
        }

        drawBatcherDashboard(ns, {
          status: "PREPPING",
          target,
          progress,
          progressText: `Synchronisation läuft... (${secsLeft.toFixed(1)}s verbleibend)`,
          greed: currentGreedFactor,
          ramNeeded: 0,
          ramFree: tFree,
          ramTotal: tRam,
          batchesSent: 0,
          batchesMax: dynamicMaxBatchesForTarget,
          eventLog,
          lastWaveProfit,
        });

        await ns.sleep(250);
      }

      batchesSentForTarget = 0;
      continue;
    }

    if (!lockedPlan) {
      target = null;
      continue;
    }

    let plan = lockedPlan;

    if (plan) {
      patchState(ns, {
        batcherRamNeeded: plan.totalRam,
        batcherTarget: target,
      });
      lastWaveProfit = maxMoney * currentGreedFactor;
    }

    // --- ⏳ RAM-STALL SCHUTZ ---
    if (totalUsableFreeRam < plan.totalRam) {
      const requiredRam = plan.totalRam;

      if (Date.now() - lastUiUpdate > 250) {
        drawBatcherDashboard(ns, {
          status: "STALLED (RAM)",
          target,
          progress: totalUsableFreeRam / Math.max(1, requiredRam),
          progressText: `Warte auf RAM-Slot: ${ns.format.ram(totalUsableFreeRam)} / ${ns.format.ram(requiredRam)}`,
          greed: currentGreedFactor,
          ramNeeded: requiredRam,
          ramFree: totalUsableFreeRam,
          ramTotal: totalUsableMaxRam,
          batchesSent: batchesSentForTarget,
          batchesMax: dynamicMaxBatchesForTarget,
          eventLog,
          lastWaveProfit,
        });
        lastUiUpdate = Date.now();
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
          logEvent("⚠️ Ziel instabil! Notfall-Prep.");
          batchesSentForTarget = 0;
          stallSettleTicks = 0;
          lockedPlan = null;
          lastLogStatus = "PREPPING";
          await ns.sleep(SPACER);
          continue;
        }
        await ns.sleep(SPACER);
        continue;
      }
    }

    stallSettleTicks = 0;
    lastLogStatus = "RUNNING";

    // 🚀 EXECUTE BATCH
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

    if (Date.now() - lastUiUpdate > 250) {
      drawBatcherDashboard(ns, {
        status: "RUNNING",
        target,
        progress: batchesSentForTarget / dynamicMaxBatchesForTarget,
        progressText: `Welle #${batchId} (${batchesSentForTarget}/${dynamicMaxBatchesForTarget} bis Rotation)`,
        greed: currentGreedFactor,
        ramNeeded: plan.totalRam,
        ramFree: totalUsableFreeRam,
        ramTotal: totalUsableMaxRam,
        batchesSent: batchesSentForTarget,
        batchesMax: dynamicMaxBatchesForTarget,
        eventLog,
        lastWaveProfit,
      });
      lastUiUpdate = Date.now();
    }

    await ns.sleep(SPACER);
  }
}

// [Die restlichen Hilfsfunktionen bleiben identisch wie in deinem Skript]

function makeProgressBar(progress: number, width = 20): string {
  const filledLength = Math.round(Math.max(0, Math.min(1, progress)) * width);
  const emptyLength = width - filledLength;
  return "█".repeat(filledLength) + "░".repeat(emptyLength);
}

function drawBatcherDashboard(ns: NS, data: DashboardData): void {
  ns.clearLog();

  const curSec = ns.getServerSecurityLevel(data.target);
  const minSec = ns.getServerMinSecurityLevel(data.target);
  const curMoney = ns.getServerMoneyAvailable(data.target);
  const maxMoney = ns.getServerMaxMoney(data.target);
  const moneyPercent = maxMoney > 0 ? (curMoney / maxMoney) * 100 : 0;

  const ramUsed = data.ramTotal - data.ramFree;
  const ramPercent = data.ramTotal > 0 ? (ramUsed / data.ramTotal) * 100 : 0;
  const bar = makeProgressBar(data.progress, 20);

  ns.print(`============================================================`);
  ns.print(
    `⚡ BIT-OS DYNAMIC BATCHER v2.0    |  Gewinn/Welle: +$${ns.format.number(data.lastWaveProfit)}`,
  );
  ns.print(`============================================================`);
  ns.print(`FOKUS-ZIEL:      ${data.target}`);
  ns.print(`STATUS:          [${bar}] ${data.status}`);
  ns.print(`DETAILS:         ${data.progressText}`);
  ns.print(
    `GIER-FAKTOR: ${(data.greed * 100).toFixed(1)}% (Est. $${ns.format.number(maxMoney * data.greed)} pro Welle)`,
  );
  ns.print(`------------------------------------------------------------`);
  ns.print(`NETZWERK-ALLOKATION:`);
  ns.print(
    `RAM Pool:    ${ns.format.ram(ramUsed)} / ${ns.format.ram(data.ramTotal)} (${ramPercent.toFixed(1)}%)`,
  );
  ns.print(
    `Wellen-Ram:  ${ns.format.ram(data.ramNeeded)} Benötigt | Frei gepoolt: ${ns.format.ram(data.ramFree)}`,
  );
  ns.print(`------------------------------------------------------------`);
  ns.print(`ZIELSERVER-ZUSTAND:`);
  ns.print(`Sicherheit:  ${curSec.toFixed(2)} / ${minSec.toFixed(2)} (Min)`);
  ns.print(
    `Finanzen:    $${ns.format.number(curMoney)} / $${ns.format.number(maxMoney)} (${moneyPercent.toFixed(1)}%)`,
  );
  ns.print(`------------------------------------------------------------`);
  ns.print(`EREIGNIS-PROTOKOLL:`);
  if (data.eventLog.length === 0) {
    ns.print(`> Warte auf Systemereignisse...`);
  } else {
    for (const log of data.eventLog) {
      ns.print(`> ${log}`);
    }
  }
  ns.print(`============================================================`);
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
  if (scriptRam === 0) return;
  let threadsRemaining = threads;

  for (const server of allServers) {
    if (!ns.hasRootAccess(server)) continue;
    let maxRam = ns.getServerMaxRam(server);
    if (server === "home") maxRam = Math.max(0, maxRam - 64);

    const freeRam = maxRam - ns.getServerUsedRam(server);
    const possibleThreads = Math.floor(freeRam / scriptRam);

    if (possibleThreads > 0) {
      const threadsToRun = Math.min(possibleThreads, threadsRemaining);
      ns.exec(script, server, threadsToRun, target, delay, id);
      threadsRemaining -= threadsToRun;
      if (threadsRemaining <= 0) break;
    }
  }
}

// 🔄 Akzeptiert jetzt bnMults für mathematische Exaktheit bei der Recovery
function executePrepPhase(
  ns: NS,
  allServers: string[],
  target: string,
  bnMults: any,
): void {
  const minSec = ns.getServerMinSecurityLevel(target);
  const curSec = ns.getServerSecurityLevel(target);
  const maxMoney = ns.getServerMaxMoney(target);
  const curMoney = ns.getServerMoneyAvailable(target);

  // 📊 Dynamische Weaken-Effektivität berechnen
  const weakenPotency = 0.05 * (bnMults.ServerWeakenRate ?? 1.0);

  if (curSec > minSec) {
    const secDeficit = curSec - minSec;
    const weakenThreads = Math.ceil(secDeficit / weakenPotency); // 🔄 Ersetzt hartcodierte 0.05
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
    let growThreads = 0;
    if (ns.formulas && ns.formulas.hacking) {
      const serverMock = ns.getServer(target);
      const player = ns.getPlayer();
      serverMock.hackDifficulty = minSec;
      serverMock.moneyAvailable = Math.max(1, curMoney);
      growThreads = Math.ceil(
        ns.formulas.hacking.growThreads(serverMock, player, maxMoney),
      );
    } else {
      const growthMultiplier = maxMoney / Math.max(1, curMoney);
      growThreads = Math.ceil(ns.growthAnalyze(target, growthMultiplier));
    }
    const weakenThreadsNeeded = Math.ceil(
      (growThreads * 0.004) / weakenPotency,
    ); // 🔄 Ersetzt hartcodierte 0.05
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

// 🔄 Reicht bnMults in die tiefere Kalkulation weiter
function findBestBatchTargetForNetwork(
  ns: NS,
  allServers: string[],
  totalNetworkRam: number,
  spacer: number,
  bnMults: any,
): string | null {
  const targets = allServers.filter(
    (s) => ns.hasRootAccess(s) && ns.getServerMaxMoney(s) > 0,
  );
  let bestTarget = null;
  let highestScore = 0;
  const playerHackLevel = ns.getHackingLevel();
  const maxAllowedWeakenMinutes = 10 + (playerHackLevel / 100) * 2;
  const DYNAMIC_MAX_WEAKEN_TIME = maxAllowedWeakenMinutes * 60 * 1000;

  for (const s of targets) {
    if (ns.getServerRequiredHackingLevel(s) > playerHackLevel) continue;

    // 🔄 Signatur angepasst: bnMults an 3. Stelle übergeben
    const testPlan = calculateBatch(ns, s, bnMults, 0.01, spacer);

    if (!testPlan || testPlan.totalRam > totalNetworkRam) continue;
    const idealExecutionTime = testPlan.executionTime;
    if (idealExecutionTime > DYNAMIC_MAX_WEAKEN_TIME) continue;
    const money = ns.getServerMaxMoney(s);
    const score = money / idealExecutionTime;
    if (score > highestScore) {
      highestScore = score;
      bestTarget = s;
    }
  }
  return bestTarget;
}
