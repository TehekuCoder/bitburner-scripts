import { NS } from "@ns";
import { getAllServers } from "/lib/network.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { patchBatcherState } from "/lib/state.js";
import { PATHS } from "/lib/paths.js";
import { HOME_RAM_RESERVE } from "/lib/constants/batcher.js";


export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "PrepEngine");

  const target = (ns.args[0] as string) || "n00dles";
  const weakenScript = PATHS.payloads.weaken;
  const growScript = PATHS.payloads.grow;

  logger.info(`🔥 Engine-Prep gestartet für Ziel: [${target}]`);

  let execCounter = 0;

  while (true) {
    if (!ns.serverExists(target)) {
      logger.error(`Ziel-Server '${target}' existiert nicht! Beende Prep.`);
      return;
    }

    const allNetwork = getAllServers(ns);

    const workerNodes = allNetwork.filter(
      (s) => ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0,
    );

    // 2. Ziel-Zustand analysieren
    const curSec = ns.getServerSecurityLevel(target);
    const minSec = ns.getServerMinSecurityLevel(target);
    const curMoney = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);

    const secDelta = curSec - minSec;
    const isSecMin = secDelta <= 0.05;
    const isMoneyMax = maxMoney > 0 ? curMoney / maxMoney >= 0.99 : true;

    // 🟢 ZIEL IST BEREITS PREPPED
    if (isSecMin && isMoneyMax) {
      logger.success(`✅ Ziel [${target}] ist vollständig PREPPED!`);

      patchBatcherState(ns, {
        batchStrategy: "PREP",
        batcherActive: true,
        batcherTarget: target,
        batcherProgress: "PREPPED 100%",
      });

      stopAllWorkers(ns, workerNodes, [weakenScript, growScript]);
      await ns.sleep(3000);
      continue;
    }

    // 3. IN-FLIGHT-ANALYSE (Nur 3 Argumente)
    const { inFlightGrowThreads, inFlightWeakenThreads } = getInFlightThreads(
      ns,
      workerNodes,
      target,
      growScript,
      weakenScript
    );

    const inFlightSecEffect =
      inFlightWeakenThreads * 0.05 - inFlightGrowThreads * 0.004;
    const projectedSec = Math.max(minSec, curSec - inFlightSecEffect);
    const projectedSecDelta = projectedSec - minSec;

    let totalGrowNeeded = 0;
    if (maxMoney > 0 && curMoney < maxMoney) {
      const moneyRatio = maxMoney / Math.max(1, curMoney);
      totalGrowNeeded = Math.ceil(ns.growthAnalyze(target, moneyRatio));
    }
    const remainingGrowNeeded = Math.max(
      0,
      totalGrowNeeded - inFlightGrowThreads,
    );

    const secIncreaseFromGrows = remainingGrowNeeded * 0.004;
    const totalSecToReduce = Math.max(
      0,
      curSec + secIncreaseFromGrows - minSec,
    );
    const totalWeakenNeeded = Math.ceil(totalSecToReduce / 0.05);
    const remainingWeakenNeeded = Math.max(
      0,
      totalWeakenNeeded - inFlightWeakenThreads,
    );

    const isFullyInFlight =
      projectedSecDelta <= 0.05 && remainingGrowNeeded <= 0;

    if (isFullyInFlight) {
      patchBatcherState(ns, {
        batchStrategy: "PREP",
        batcherActive: true,
        batcherTarget: target,
        batcherProgress: `PREP IN-FLIGHT ✈️ (G:${inFlightGrowThreads} | W:${inFlightWeakenThreads})`,
      });

      await ns.sleep(2000);
      continue;
    }

    const moneyPct =
      maxMoney > 0 ? ((curMoney / maxMoney) * 100).toFixed(1) : "100";
    const secStatus = `+${secDelta.toFixed(2)}`;
    patchBatcherState(ns, {
      batchStrategy: "PREP",
      batcherActive: true,
      batcherTarget: target,
      batcherProgress: `PREP ($: ${moneyPct}% | Sec: ${secStatus})`,
    });

    // 4. Modus bestimmen & Worker deployen
    let mode: "WEAKEN_ONLY" | "GROW_AND_WEAKEN" = "GROW_AND_WEAKEN";
    if (secDelta > 0.5 || projectedSecDelta > 0.5) {
      mode = "WEAKEN_ONLY";
    }

    execCounter = (execCounter + 1) % 10000;

    deployPrepWorkers(
      ns,
      workerNodes,
      target,
      mode,
      remainingWeakenNeeded,
      remainingGrowNeeded,
      weakenScript,
      growScript,
      execCounter,
    );

    await ns.sleep(2000);
  }
}

function getInFlightThreads(
  ns: NS,
  workerNodes: string[],
  target: string,
  growScript: string,
  weakenScript: string,
): { inFlightGrowThreads: number; inFlightWeakenThreads: number } {
  let inFlightGrowThreads = 0;
  let inFlightWeakenThreads = 0;

  for (const node of workerNodes) {
    for (const proc of ns.ps(node)) {
      if (proc.args[0] === target) {
        if (proc.filename === growScript || proc.filename.endsWith(growScript)) {
          inFlightGrowThreads += proc.threads;
        } else if (proc.filename === weakenScript || proc.filename.endsWith(weakenScript)) {
          inFlightWeakenThreads += proc.threads;
        }
      }
    }
  }

  return { inFlightGrowThreads, inFlightWeakenThreads };
}

function deployPrepWorkers(
  ns: NS,
  workerNodes: string[],
  target: string,
  mode: "WEAKEN_ONLY" | "GROW_AND_WEAKEN",
  maxWeakenNeeded: number,
  maxGrowNeeded: number,
  weakenScript: string,
  growScript: string,
  execCounter: number,
): void {
  const weakenCost = ns.getScriptRam(weakenScript, "home");
  const growCost = ns.getScriptRam(growScript, "home");

  let remainingWeakenCap = maxWeakenNeeded;
  let remainingGrowCap = maxGrowNeeded;

  for (const node of workerNodes) {
    if (mode === "WEAKEN_ONLY" && remainingWeakenCap <= 0) break;
    if (
      mode === "GROW_AND_WEAKEN" &&
      remainingGrowCap <= 0 &&
      remainingWeakenCap <= 0
    )
      break;

    const maxRam = ns.getServerMaxRam(node);
    const usedRam = ns.getServerUsedRam(node);
    const reservedRam = node === "home" ? HOME_RAM_RESERVE : 0;
    const freeRam = Math.max(0, maxRam - usedRam - reservedRam);

    if (freeRam < Math.min(weakenCost, growCost)) continue;

    if (mode === "WEAKEN_ONLY") {
      const threadsPossible = Math.floor(freeRam / weakenCost);
      const threadsToRun = Math.min(threadsPossible, remainingWeakenCap);

      if (threadsToRun > 0) {
        ns.exec(
          weakenScript,
          node,
          threadsToRun,
          target,
          0,
          `${execCounter}_${Math.random()}`,
        );
        remainingWeakenCap -= threadsToRun;
      }
    } else {
      // Exakte Ratio: 25 Grow zu 2 Weaken (12.5 : 1)
      const unitCost = 25 * growCost + 2 * weakenCost;
      const unitsPossible = Math.floor(freeRam / unitCost);

      const maxUnitsByCap = Math.min(
        Math.floor(remainingGrowCap / 25),
        Math.floor(remainingWeakenCap / 2),
      );

      const units = Math.max(0, Math.min(unitsPossible, maxUnitsByCap));

      let gThreads = units * 25;
      let wThreads = units * 2;
      let remainingRam =
        freeRam - (gThreads * growCost + wThreads * weakenCost);

      // Rest-RAM feingranular mit Grow auffüllen
      while (remainingRam >= growCost && remainingGrowCap - gThreads > 0) {
        gThreads++;
        remainingRam -= growCost;
      }

      // Weaken auffüllen, um Sec-Increase durch Grow zu kompensieren
      const requiredWeakenForGrows = Math.ceil(gThreads * 0.08); // 0.004 / 0.05
      while (
        remainingRam >= weakenCost &&
        (wThreads < requiredWeakenForGrows || remainingWeakenCap - wThreads > 0)
      ) {
        wThreads++;
        remainingRam -= weakenCost;
      }

      if (gThreads > 0) {
        ns.exec(
          growScript,
          node,
          gThreads,
          target,
          0,
          `${execCounter}_${Math.random()}`,
        );
        remainingGrowCap -= gThreads;
      }
      if (wThreads > 0) {
        ns.exec(
          weakenScript,
          node,
          wThreads,
          target,
          0,
          `${execCounter}_${Math.random()}`,
        );
        remainingWeakenCap -= wThreads;
      }
    }
  }
}

function stopAllWorkers(
  ns: NS,
  workerNodes: string[],
  scripts: string[],
): void {
  const scriptNames = scripts.map((s) => s.replace(/^.*[\\/]/, ""));
  for (const node of workerNodes) {
    for (const proc of ns.ps(node)) {
      if (scriptNames.some((name) => proc.filename.endsWith(name))) {
        ns.kill(proc.pid);
      }
    }
  }
}
