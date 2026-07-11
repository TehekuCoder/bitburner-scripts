import { NS } from "@ns";
import { calculateBatch } from "../utils/batch-calculator.js";
import { getAllServers } from "../lib/network.js";
import { patchState, loadState } from "./state-manager.js";
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
  // ns.ui.openTail();

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

    const currentState = loadState(ns);
    const shareBufferPercent =
      currentState?.fillerConfig?.shareMaxRamPercent || 0.0;

    for (const server of cachedServers) {
      if (!ns.hasRootAccess(server)) continue;
      let maxRam = ns.getServerMaxRam(server);
      if (server === "home") maxRam = Math.max(0, maxRam - 64);

      // [NEU] Wenn wir im REP-Modus sind, halten wir den Share-Prozentsatz für den Batcher unsichtbar
      if (currentState?.strategy === "REP" && server !== "home") {
        maxRam = maxRam * (1 - shareBufferPercent);
      }

      const usedRam = ns.getServerUsedRam(server);
      const freeRam = Math.max(0, maxRam - usedRam);

      totalUsableMaxRam +=
        Math.floor(maxRam / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;
      totalUsableFreeRam +=
        Math.floor(freeRam / SCRIPT_RAM_BASE) * SCRIPT_RAM_BASE;
    }

    // 🎯 TARGETING
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

        const serverMock = ns.getServer(target);
        serverMock.hackDifficulty = serverMock.minDifficulty;
        const weakenTime = ns.formulas!.hacking.weakenTime(
          serverMock,
          ns.getPlayer(),
        );

        const maxConcurrentBatches = Math.max(
          1,
          Math.floor(weakenTime / SPACER),
        );

        const idealBatchRam = totalUsableMaxRam / maxConcurrentBatches;

        let largestSingleServerRam = 0;
        if (cachedServers.length > 0) {
          largestSingleServerRam = ns.getServerMaxRam(cachedServers[0]);
          if (cachedServers[0] === "home") {
            largestSingleServerRam = Math.max(0, largestSingleServerRam - 64);
          }
        }

        const maxAllowedBatchRam = Math.min(
          idealBatchRam,
          largestSingleServerRam,
        );

        dynamicMaxBatchesForTarget = Math.max(500, maxConcurrentBatches * 2);

        currentGreedFactor = 0.9;
        let lockPlan = calculateBatch(
          ns,
          target,
          bnMults,
          currentGreedFactor,
          SPACER,
        );

        while (
          (lockPlan === null || lockPlan.totalRam > maxAllowedBatchRam) &&
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
            `🔒 Pipeline-Plan fixiert: ${target} @ Gier ${(currentGreedFactor * 100).toFixed(1)}%`,
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

    // 📈 LEVEL-UP & TIMING-ANTIZIPATION (ANTI-CLIPPING)
    const serverMock = ns.getServer(target);
    serverMock.hackDifficulty = serverMock.minDifficulty;
    const trueWeakenTime = ns.formulas!.hacking.weakenTime(
      serverMock,
      ns.getPlayer(),
    );
    const planWeakenTime = lockedPlan.executionTime - SPACER * 2; // Basis-Weaken-Zeit des aktuellen Plans

    // Wenn die echte Laufzeit kürzer ist als die geplante, gab es ein Level-Up!
    if (trueWeakenTime < planWeakenTime) {
      const timeDelta = planWeakenTime - trueWeakenTime;
      logEvent(
        `📈 Level-Up erkannt! Justiere Zeitachse... (-${(timeDelta / 1000).toFixed(2)}s)`,
      );

      // 1. Berechne den Plan sofort neu, damit die Delays IM Batch wieder absolut synchron sind
      const newPlan = calculateBatch(
        ns,
        target,
        bnMults,
        currentGreedFactor,
        SPACER,
      );

      if (newPlan) {
        lockedPlan = newPlan;

        // 2. MATHEMATISCHER PUFFER: Wir verzögern die Main-Loop um exakt die geschrumpfte Zeit.
        // Dadurch schlagen die neuen, schnelleren Batches exakt im korrekten Abstand NACH den alten,
        // langsameren Batches auf, ohne sie im Äther zu überholen.
        await ns.sleep(timeDelta);
      }
    }

    let plan = lockedPlan;

    if (plan) {
      patchState(ns, {
        batcherRamNeeded: plan.totalRam,
        batcherTarget: target,
      });
      lastWaveProfit = maxMoney * currentGreedFactor;
    }

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

      await ns.sleep(SPACER * 4);
      continue;
    }

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
    // FIX: Setzt den Status dynamisch, damit die Settle-Ticks oben greifen können!
    lastLogStatus =
      curSec > minSec || curMoney < maxMoney ? "WAIT_SETTLE" : "RUNNING";

    const dispatchSuccess = dispatchSplitBatch(
      ns,
      cachedServers,
      plan,
      target,
      batchId,
    );

    if (!dispatchSuccess) {
      if (Date.now() - lastUiUpdate > 250) {
        drawBatcherDashboard(ns, {
          status: "STALLED (FRAG)",
          target,
          progress: totalUsableFreeRam / plan.totalRam,
          progressText: `RAM fragmentiert. Warte auf atomaren Slot...`,
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
      maxRam = Math.max(0, maxRam - 64);
    } else if (currentState?.strategy === "REP") {
      // 🔥 FIX: Schütze den Share-Buffer vor der tatsächlichen Skript-Ausführung
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
    );
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

// 🔧 FIX: Optimierte Zielfindung für riesige Netzwerke (PB-Klasse)
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

  // Gelockertes Failsafe auf 60 Minuten. Großer RAM erlaubt gewaltige Pipelines!
  const DYNAMIC_MAX_WEAKEN_TIME = 60 * 60 * 1000;

  for (const s of targets) {
    if (ns.getServerRequiredHackingLevel(s) > playerHackLevel) continue;

    // Erster Test mit 10% statt 1% Gier, um den 0-Thread-Fehler bei starkem Hacking zu umgehen
    let testPlan = calculateBatch(ns, s, bnMults, 0.1, spacer);

    // Zweiter Test-Fallback auf 40% Standardgier, falls 10% mathematisch unmöglich sind
    if (!testPlan) {
      testPlan = calculateBatch(ns, s, bnMults, 0.4, spacer);
    }

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

function dispatchSplitBatch(
  ns: NS,
  allServers: string[],
  plan: any,
  target: string,
  batchId: number,
): boolean {
  // Am Anfang der Funktionen dispatchSplitBatch und dispatchBatchScript einfügen:
  const currentState = loadState(ns);
  const shareBufferPercent =
    currentState?.fillerConfig?.shareMaxRamPercent || 0.0;

  // Liste aller Teil-Aufgaben eines vollständigen HWGW-Batches
  const tasks = [
    {
      script: "tasks/hack.js",
      threads: plan.hackThreads,
      delay: plan.hackDelay,
    },
    {
      script: "tasks/weaken.js",
      threads: plan.weaken1Threads,
      delay: plan.weaken1Delay,
    },
    {
      script: "tasks/grow.js",
      threads: plan.growThreads,
      delay: plan.growDelay,
    },
    {
      script: "tasks/weaken.js",
      threads: plan.weaken2Threads,
      delay: plan.weaken2Delay,
    },
  ];

  // Vorab-Sicherheitscheck: Haben wir im gesamten Netzwerk überhaupt genug RAM?
  let totalFree = 0;
  for (const s of allServers) {
    if (!ns.hasRootAccess(s)) continue;
    let maxRam = ns.getServerMaxRam(s);

    if (s === "home") {
      maxRam = Math.max(0, maxRam - 64);
    } else if (currentState?.strategy === "REP") {
      // 🌟 FIX: Der Pre-Check muss die REP-Drosselung ebenfalls sehen!
      maxRam = maxRam * (1 - shareBufferPercent);
    }

    totalFree += maxRam - ns.getServerUsedRam(s);
  }

  if (totalFree < plan.totalRam) return false;

  // Verteile jede Aufgabe Thread für Thread auf die verfügbaren Server
  for (const task of tasks) {
    let threadsLeft = task.threads;
    if (threadsLeft <= 0) continue;

    for (const server of allServers) {
      if (!ns.hasRootAccess(server)) continue;

      let maxRam = ns.getServerMaxRam(server);
      if (server === "home") {
        maxRam = Math.max(0, maxRam - 64);
      } else if (currentState?.strategy === "REP") {
        // 🔥 FIX: Schütze den Share-Buffer vor der tatsächlichen Skript-Ausführung
        maxRam = maxRam * (1 - shareBufferPercent);
      }

      const freeRam = maxRam - ns.getServerUsedRam(server);
      const scriptRam = ns.getScriptRam(task.script);
      const possibleThreads = Math.floor(freeRam / scriptRam);

      if (possibleThreads > 0) {
        const toDeploy = Math.min(possibleThreads, threadsLeft);

        ns.exec(task.script, server, toDeploy, target, task.delay, batchId);
        threadsLeft -= toDeploy;

        if (threadsLeft <= 0) break; // Aufgabe für diesen Batch vollständig verteilt
      }
    }

    // Falls die Threads trotz Vorab-Check nicht untergebracht wurden (z.B. wegen plötzlicher Skript-Kosten)
    if (threadsLeft > 0) {
      return false;
    }
  }
  return true;
}
