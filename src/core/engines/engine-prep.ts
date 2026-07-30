import { NS } from "@ns";
import { breakAndInfectNetwork, getAllServers } from "/lib/network.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { patchBatcherState } from "/lib/state.js";
import { PATHS } from "/lib/paths";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "PrepEngine");

  const target = (ns.args[0] as string) || "n00dles";

  const weakenScript = PATHS.payloads.weaken;
  const growScript = PATHS.payloads.grow;

  logger.info(`🔥 Engine-Prep gestartet für Ziel: [${target}]`);

  while (true) {
    if (!ns.serverExists(target)) {
      logger.error(`Ziel-Server '${target}' existiert nicht! Beende Prep.`);
      return;
    }

    // 1. Netzwerk aktualisieren & Infizieren
    breakAndInfectNetwork(ns);
    const allNetwork = getAllServers(ns);

    // Verfügbare Worker-Knoten sammeln (Home + pServers + Infected Hosts)
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

    // 🟢 ZIEL IST BEREITS RELL PREPPED!
    if (isSecMin && isMoneyMax) {
      logger.success(`✅ Ziel [${target}] ist vollständig PREPPED!`);

      patchBatcherState(ns, {
        batcherTarget: target,
        batcherProgress: "PREPPED 100%",
      });

      stopAllWorkers(ns, workerNodes, [weakenScript, growScript]);
      await ns.sleep(3000);
      continue;
    }

    // 3. IN-FLIGHT-ANALYSE: Bereits laufende Prozesse ermitteln
    const { inFlightGrowThreads, inFlightWeakenThreads } = getInFlightThreads(
      ns,
      workerNodes,
      target,
      weakenScript,
      growScript,
    );

    // Berechne Effekt der In-Flight-Skripte:
    // - 1 Weaken senkt Sec um 0.05
    // - 1 Grow erhöht Sec um 0.004
    const inFlightSecEffect =
      inFlightWeakenThreads * 0.05 - inFlightGrowThreads * 0.004;
    const projectedSec = Math.max(minSec, curSec - inFlightSecEffect);
    const projectedSecDelta = projectedSec - minSec;

    // Erforderliche Grow-Threads ermitteln
    let totalGrowNeeded = 0;
    if (maxMoney > 0 && curMoney < maxMoney) {
      const moneyRatio = maxMoney / Math.max(1, curMoney);
      totalGrowNeeded = Math.ceil(ns.growthAnalyze(target, moneyRatio));
    }
    const remainingGrowNeeded = Math.max(
      0,
      totalGrowNeeded - inFlightGrowThreads,
    );

    // Erforderliche Weaken-Threads ermitteln (inklusive Ausgleich für benötigte Grow-Threads)
    const secIncreaseFromGrows = remainingGrowNeeded * 0.004;
    const totalSecToReduce = Math.max(0, curSec + secIncreaseFromGrows - minSec);
    const totalWeakenNeeded = Math.ceil(totalSecToReduce / 0.05);
    const remainingWeakenNeeded = Math.max(
      0,
      totalWeakenNeeded - inFlightWeakenThreads,
    );

    // ✈️ PRÜFEN, OB BEREITS ALLES IN FLIGHT IST
    const isFullyInFlight =
      projectedSecDelta <= 0.05 && remainingGrowNeeded <= 0;

    if (isFullyInFlight) {
      patchBatcherState(ns, {
        batcherTarget: target,
        batcherProgress: `PREP IN-FLIGHT ✈️ (Warte auf Landung... G:${inFlightGrowThreads} | W:${inFlightWeakenThreads})`,
      });

      await ns.sleep(2000);
      continue;
    }

    // Status ins Dashboard / State schreiben
    const moneyPct =
      maxMoney > 0 ? ((curMoney / maxMoney) * 100).toFixed(1) : "100";
    const secStatus = `+${secDelta.toFixed(2)}`;
    patchBatcherState(ns, {
      batcherTarget: target,
      batcherProgress: `PREP ($: ${moneyPct}% | Sec: ${secStatus})`,
    });

    // 4. Modus bestimmen & Worker gezielt deployen
    let mode: "WEAKEN_ONLY" | "GROW_AND_WEAKEN" = "GROW_AND_WEAKEN";
    if (secDelta > 0.5 || projectedSecDelta > 0.5) {
      mode = "WEAKEN_ONLY";
    }

    deployPrepWorkers(
      ns,
      workerNodes,
      target,
      mode,
      remainingWeakenNeeded,
      remainingGrowNeeded,
      weakenScript,
      growScript,
    );

    await ns.sleep(2000);
  }
}

/**
  * Analysiert laufende Worker-Prozesse auf allen Knoten für das Ziel.
  */
function getInFlightThreads(
  ns: NS,
  workerNodes: string[],
  target: string,
  weakenScript: string,
  growScript: string,
): { inFlightGrowThreads: number; inFlightWeakenThreads: number } {
  let inFlightGrowThreads = 0;
  let inFlightWeakenThreads = 0;

  for (const node of workerNodes) {
    for (const proc of ns.ps(node)) {
      if (proc.args[0] === target) {
        if (proc.filename === growScript) {
          inFlightGrowThreads += proc.threads;
        } else if (proc.filename === weakenScript) {
          inFlightWeakenThreads += proc.threads;
        }
      }
    }
  }

  return { inFlightGrowThreads, inFlightWeakenThreads };
}

/**
  * Verteilt Weaken/Grow-Prozesse effizient über das Netz, gedeckelt auf den tatsächlichen Bedarf.
  */
function deployPrepWorkers(
  ns: NS,
  workerNodes: string[],
  target: string,
  mode: "WEAKEN_ONLY" | "GROW_AND_WEAKEN",
  maxWeakenNeeded: number,
  maxGrowNeeded: number,
  weakenScript: string,
  growScript: string,
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

    // Skripte auf Zielknoten kopieren falls nötig
    if (node !== "home") {
      if (!ns.fileExists(weakenScript, node))
        ns.scp(weakenScript, node, "home");
      if (!ns.fileExists(growScript, node)) ns.scp(growScript, node, "home");
    }

    const maxRam = ns.getServerMaxRam(node);
    const usedRam = ns.getServerUsedRam(node);
    const reservedRam = node === "home" ? Math.min(20, maxRam * 0.2) : 0;
    let freeRam = Math.max(0, maxRam - usedRam - reservedRam);

    if (freeRam < Math.min(weakenCost, growCost)) continue;

    if (mode === "WEAKEN_ONLY") {
      const threadsPossible = Math.floor(freeRam / weakenCost);
      const threadsToRun = Math.min(threadsPossible, remainingWeakenCap);

      if (threadsToRun > 0) {
        ns.exec(weakenScript, node, threadsToRun, target, 0, Math.random());
        remainingWeakenCap -= threadsToRun;
      }
    } else {
      // 🟢 OPTIMIERTES VERHÄLTNIS: 12x Grow zu 1x Weaken
      const unitCost = 12 * growCost + 1 * weakenCost;
      const unitsPossible = Math.floor(freeRam / unitCost);

      // Deckelung auf noch benötigte Cap anwenden
      const maxUnitsByCap = Math.min(
        Math.floor(remainingGrowCap / 12),
        remainingWeakenCap,
      );
      const units = Math.max(0, Math.min(unitsPossible, maxUnitsByCap));

      let gThreads = units * 12;
      let wThreads = units * 1;
      let remainingRam = freeRam - units * unitCost;

      // Rest-RAM feinfühlig nachfüllen
      while (
        remainingRam >= growCost * 12 + weakenCost &&
        remainingGrowCap - gThreads >= 12 &&
        remainingWeakenCap - wThreads >= 1
      ) {
        gThreads += 12;
        wThreads += 1;
        remainingRam -= growCost * 12 + weakenCost;
      }

      while (
        remainingRam >= growCost &&
        remainingGrowCap - gThreads > 0
      ) {
        gThreads++;
        remainingRam -= growCost;
      }

      while (
        remainingRam >= weakenCost &&
        remainingWeakenCap - wThreads > 0
      ) {
        wThreads++;
        remainingRam -= weakenCost;
      }

      if (gThreads > 0) {
        ns.exec(growScript, node, gThreads, target, 0, Math.random());
        remainingGrowCap -= gThreads;
      }
      if (wThreads > 0) {
        ns.exec(weakenScript, node, wThreads, target, 0, Math.random());
        remainingWeakenCap -= wThreads;
      }
    }
  }
}

/**
  * Beendet laufende Prep-Worker auf allen Knoten.
  */
function stopAllWorkers(
  ns: NS,
  workerNodes: string[],
  scripts: string[],
): void {
  for (const node of workerNodes) {
    for (const proc of ns.ps(node)) {
      if (scripts.includes(proc.filename)) {
        ns.kill(proc.pid);
      }
    }
  }
}