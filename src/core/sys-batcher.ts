import { NS } from "@ns";
import { getAllServers } from "../lib/network.js";
import { patchState, loadState } from "./state-manager.js";
import { loadBnMults } from "../lib/state.js";
import { Logger } from "./logger.js";

// Wir importieren NUR das Interface für Typsicherheit (kostet 0.00 GB RAM zur Laufzeit!)
import { BatchPlan } from "../utils/batch-calculator.js";

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

const HOME_RAM_RESERVE = 64;
const SCRIPT_RAM_BASE = 1.75;
const SPACER = 80;

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

  const logger = new Logger(ns, "Batcher", "INFO");
  const bnMults = loadBnMults(ns);

  if (
    (bnMults.ScriptHackMoneyGain ?? 1) === 0 ||
    (bnMults.ServerMaxMoney ?? 1) === 0
  ) {
    logger.error(
      "Hacking-Multiplikatoren blockieren Profit-Generierung. Batcher terminiert.",
    );
    logEvent("🛑 Hacking wirft hier kein Geld ab. Batcher deaktiviert.");
    return;
  }

  let batchId = 0;
  let target: string | null = null;
  let batchesSentForTarget = 0;
  let dynamicMaxBatchesForTarget = 500;

  let lastLogStatus = "";
  let stallSettleTicks = 0;
  let lockedPlan: BatchPlan | null = null;
  let lastWaveProfit = 0;

  logger.info("System initialisiert. Synchronisiere Netzwerk-Pool...");
  logEvent("System initialisiert. Warte auf Netzwerk-Pool...");

  while (true) {
    updateServerCache(ns);

    let totalUsableMaxRam = 0;
    let totalUsableFreeRam = 0;

    const currentState = loadState(ns);
    const shareBufferPercent =
      currentState?.fillerConfig?.shareMaxRamPercent || 0.0;

    for (const server of cachedServers) {
      if (!ns.hasRootAccess(server)) continue;
      let maxRam = ns.getServerMaxRam(server);
      if (server === "home") maxRam = Math.max(0, maxRam - HOME_RAM_RESERVE);

      if (server !== "home" && shareBufferPercent > 0) {
        maxRam = maxRam * (1 - shareBufferPercent);
      }

      const usedRam = ns.getServerUsedRam(server);
      const freeRam = Math.max(0, maxRam - usedRam);

      totalUsableMaxRam +=
        Math.floor(maxRam / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;
      totalUsableFreeRam +=
        Math.floor(freeRam / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;
    }

    // 🎯 TARGETING & REPLANNING (Ausgelagert in den Planer!)
    if (!target || batchesSentForTarget >= dynamicMaxBatchesForTarget) {
      logger.info("Starte Batch-Planer für Zielfindung...");
      logEvent("📡 Suche optimales Ziel...");

      // Günstiges ns.exec auf Home nutzen (Kostet 0 GB, da ns.exec sowieso im RAM geladen ist!)
      const pid = ns.exec("/utils/batch-planner.js", "home", 1);
      if (pid > 0) {
        while (ns.isRunning(pid)) {
          await ns.sleep(50);
        }
      }

      const newState = loadState(ns);
      target = newState?.batcherTarget || null;
      lockedPlan = newState?.batcherPlan || null;
      dynamicMaxBatchesForTarget = newState?.batcherDynamicMaxBatches || 500;
      batchesSentForTarget = 0;

      if (target && lockedPlan) {
        logger.success(
          `Pipeline-Plan fixiert: ${target} (Ram: ${ns.format.ram(lockedPlan.totalRam)})`,
        );
        logEvent(`🔒 Pipeline-Plan geladen: ${target}`);
      } else {
        logger.warn(`Kein valides Ziel gefunden. Rotiere Zielfindung...`);
        target = null;
        lockedPlan = null;
        await ns.sleep(5000);
        continue;
      }
    }

    const minSec = ns.getServerMinSecurityLevel(target);
    const curSec = ns.getServerSecurityLevel(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const curMoney = ns.getServerMoneyAvailable(target);

    const isMassiveDesync = curSec > minSec + 1 || curMoney < maxMoney * 0.85;
    const needsInitialPrep =
      batchesSentForTarget === 0 && (curSec > minSec || curMoney < maxMoney);

    // --- KALIBRIERUNGS- & DESYNC-MANAGEMENT ---
    if (needsInitialPrep || isMassiveDesync) {
      const currentWeakenTime = ns.getWeakenTime(target);
      lockedPlan = null;
      patchState(ns, { batcherTarget: target });

      if (batchesSentForTarget === 0) {
        logger.info(`Initialisiere Prep-Phase für Zielserver: ${target}`);
        logEvent(`🔧 Kalibrierte Prep-Welle abgefeuert.`);
        executePrepPhase(ns, cachedServers, target, bnMults);
      } else {
        logger.warn(
          `🚨 Pipeline Desync auf ${target} erkannt! Flushe Pipeline...`,
        );
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
          if (s === "home") mRam = Math.max(0, mRam - HOME_RAM_RESERVE);
          if (currentState?.strategy === "REP" && s !== "home") {
            mRam = mRam * (1 - shareBufferPercent);
          }
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
          greed: 0.0, // Schätzung
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

    // 📈 LEVEL-UP ANTIZIPATION (Über extrem günstiges ns.getWeakenTime!)
    const trueWeakenTime = ns.getWeakenTime(target);
    const planWeakenTime = lockedPlan.executionTime - SPACER * 2;

    if (trueWeakenTime < planWeakenTime) {
      const timeDelta = planWeakenTime - trueWeakenTime;
      logger.info(
        `📈 Level-Up registriert! Laufzeitverkürzung um ${(timeDelta / 1000).toFixed(2)}s. Rufe Planer...`,
      );
      logEvent(`📈 Level-Up erkannt! Rekalibriere...`);

      const pid = ns.exec("/utils/batch-planner.js", "home", 1);
      if (pid > 0) {
        while (ns.isRunning(pid)) {
          await ns.sleep(50);
        }
      }
      const newState = loadState(ns);
      lockedPlan = newState?.batcherPlan || null;

      await ns.sleep(timeDelta); // Überholpuffer
    }

    const plan = lockedPlan;
    if (!plan) {
      target = null;
      continue;
    }

    // Ab hier weiß TS garantiert: 'plan' ist vom Typ 'BatchPlan' und niemals 'null'
    patchState(ns, {
      batcherRamNeeded: plan.totalRam,
      batcherTarget: target,
    });

    const estimatedGreed = plan.hackThreads * 0.04;
    lastWaveProfit = maxMoney * estimatedGreed;

    // --- RAM RESOURCE LOCK CHECKS ---
    if (totalUsableFreeRam < plan.totalRam) {
      const requiredRam = plan.totalRam;

      if (Date.now() - lastUiUpdate > 250) {
        drawBatcherDashboard(ns, {
          status: "STALLED (RAM)",
          target,
          progress: totalUsableFreeRam / Math.max(1, requiredRam),
          progressText: `Warte auf RAM-Slot: ${ns.format.ram(totalUsableFreeRam)} / ${ns.format.ram(requiredRam)}`,
          greed: plan.hackThreads * 0.02, // Dynamisch geschätzt
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

      await ns.sleep(SPACER * 4);
      continue;
    }

    if (lastLogStatus.startsWith("WAIT_")) {
      const freshSec = ns.getServerSecurityLevel(target);
      const freshMoney = ns.getServerMoneyAvailable(target);

      if (freshSec > minSec || freshMoney < maxMoney) {
        stallSettleTicks++;

        if (stallSettleTicks > 25) {
          logger.warn(
            `Zielserver ${target} nach Settle-Ticks instabil. Erzwinge Notfall-Prep.`,
          );
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
    lastLogStatus =
      curSec > minSec || curMoney < maxMoney ? "WAIT_SETTLE" : "RUNNING";

    // 🚀 BATCH CLUSTER ALLOKATION
    const dispatchSuccess = dispatchSplitBatch(
      ns,
      cachedServers,
      plan,
      target,
      batchId,
      logger,
    );

    if (!dispatchSuccess) {
      if (Date.now() - lastUiUpdate > 250) {
        drawBatcherDashboard(ns, {
          status: "STALLED (FRAG)",
          target,
          progress: totalUsableFreeRam / plan.totalRam,
          progressText: `RAM fragmentiert. Warte auf atomaren Slot...`,
          greed: plan.hackThreads * 0.02,
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
      continue;
    }

    batchId++;
    batchesSentForTarget++;

    if (Date.now() - lastUiUpdate > 250) {
      drawBatcherDashboard(ns, {
        status: "RUNNING",
        target,
        progress: batchesSentForTarget / dynamicMaxBatchesForTarget,
        progressText: `Welle #${batchId} (${batchesSentForTarget}/${dynamicMaxBatchesForTarget} bis Rotation)`,
        greed: plan.hackThreads * 0.02,
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

function makeProgressBar(progress: number, width = 20): string {
  const filledLength = Math.round(Math.max(0, Math.min(1, progress)) * width);
  const emptyLength = width - filledLength;
  return "█".repeat(filledLength) + "░".repeat(emptyLength);
}

function drawBatcherDashboard(ns: NS, data: DashboardData): void {
  ns.clearLog();

  const hasValidTarget = data.target !== "Keines" && data.target !== "";

  const curSec = hasValidTarget ? ns.getServerSecurityLevel(data.target) : 0;
  const minSec = hasValidTarget ? ns.getServerMinSecurityLevel(data.target) : 0;
  const curMoney = hasValidTarget ? ns.getServerMoneyAvailable(data.target) : 0;
  const maxMoney = hasValidTarget ? ns.getServerMaxMoney(data.target) : 0;

  const moneyPercent = maxMoney > 0 ? (curMoney / maxMoney) * 100 : 0;
  const ramUsed = data.ramTotal - data.ramFree;
  const ramPercent = data.ramTotal > 0 ? (ramUsed / data.ramTotal) * 100 : 0;
  const bar = makeProgressBar(data.progress, 20);

  ns.print(`============================================================`);
  ns.print(
    `⚡ BIT-OS DYNAMIC BATCHER v2.1    |  Gewinn/Welle: +$${ns.format.number(data.lastWaveProfit)}`,
  );
  ns.print(`============================================================`);
  ns.print(`FOKUS-ZIEL:      ${data.target}`);
  ns.print(`STATUS:          [${bar}] ${data.status}`);
  ns.print(`DETAILS:         ${data.progressText}`);
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
  const currentState = loadState(ns);
  const shareBufferPercent =
    currentState?.fillerConfig?.shareMaxRamPercent || 0.0;

  if (threads <= 0) return;
  const scriptRam = ns.getScriptRam(script);
  if (scriptRam === 0) return;
  let threadsRemaining = threads;

  for (const server of allServers) {
    if (!ns.hasRootAccess(server)) continue;
    let maxRam = ns.getServerMaxRam(server);
    if (server === "home") {
      maxRam = Math.max(0, maxRam - HOME_RAM_RESERVE);
    } else if (currentState?.strategy === "REP") {
      maxRam = maxRam * (1 - shareBufferPercent);
    }

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
  const weakenPotency = 0.05 * (bnMults.ServerWeakenRate ?? 1.0);

  if (curSec > minSec) {
    const secDeficit = curSec - minSec;
    const weakenThreads = Math.ceil(secDeficit / weakenPotency);
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
    const growthMultiplier = maxMoney / Math.max(1, curMoney);
    const growThreads = Math.ceil(ns.growthAnalyze(target, growthMultiplier));
    const weakenThreadsNeeded = Math.ceil(
      (growThreads * 0.004) / weakenPotency,
    );

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

function dispatchSplitBatch(
  ns: NS,
  allServers: string[],
  plan: BatchPlan,
  target: string,
  batchId: number,
  logger: Logger,
): boolean {
  const currentState = loadState(ns);
  const shareBufferPercent =
    currentState?.fillerConfig?.shareMaxRamPercent || 0.0;

  const tasks = [
    {
      script: "/tasks/hack.js",
      threads: plan.hackThreads,
      delay: plan.hackDelay,
    },
    {
      script: "/tasks/weaken.js",
      threads: plan.weaken1Threads,
      delay: plan.weaken1Delay,
    },
    {
      script: "/tasks/grow.js",
      threads: plan.growThreads,
      delay: plan.growDelay,
    },
    {
      script: "/tasks/weaken.js",
      threads: plan.weaken2Threads,
      delay: plan.weaken2Delay,
    },
  ];

  let totalFree = 0;
  for (const s of allServers) {
    if (!ns.hasRootAccess(s)) continue;
    let maxRam = ns.getServerMaxRam(s);

    if (s === "home") {
      maxRam = Math.max(0, maxRam - HOME_RAM_RESERVE);
    } else if (currentState?.strategy === "REP") {
      maxRam = maxRam * (1 - shareBufferPercent);
    }

    totalFree += maxRam - ns.getServerUsedRam(s);
  }

  if (totalFree < plan.totalRam) return false;

  for (const task of tasks) {
    let threadsLeft = task.threads;
    if (threadsLeft <= 0) continue;

    for (const server of allServers) {
      if (!ns.hasRootAccess(server)) continue;

      let maxRam = ns.getServerMaxRam(server);
      if (server === "home") {
        maxRam = Math.max(0, maxRam - HOME_RAM_RESERVE);
      } else if (currentState?.strategy === "REP") {
        maxRam = maxRam * (1 - shareBufferPercent);
      }

      const freeRam = maxRam - ns.getServerUsedRam(server);
      const scriptRam = ns.getScriptRam(task.script);
      const possibleThreads = Math.floor(freeRam / scriptRam);

      if (possibleThreads > 0) {
        const toDeploy = Math.min(possibleThreads, threadsLeft);

        if (server !== "home" && !ns.fileExists(task.script, server)) {
          ns.scp(task.script, server, "home");
          logger.info(
            `💾 Skript '${task.script}' auf Zielknoten '${server}' deployt.`,
          );
        }

        const pid = ns.exec(
          task.script,
          server,
          toDeploy,
          target,
          task.delay,
          batchId,
        );
        if (pid > 0) {
          threadsLeft -= toDeploy;
        }

        if (threadsLeft <= 0) break;
      }
    }

    if (threadsLeft > 0) {
      return false;
    }
  }
  return true;
}
