import { NS } from "@ns";
import { Logger } from "/lib/logger";
import { breakAndInfectNetwork, getAllServers } from "/lib/network";
import { patchState } from "/lib/state";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "ProtoBatcher", "INFO");

  const target = (ns.args[0] as string) || "n00dles";

  const scripts = {
    hack: "payloads/hack.js",
    grow: "payloads/grow.js",
    weaken: "payloads/weaken.js",
  };

  const OFFSET = 50; // 50ms Abstand zwischen den Landungen

  logger.info(`🧪 Proto-Batcher gestartet für Ziel: [${target}]`);

  while (true) {
    if (!ns.serverExists(target)) {
      logger.error(`Ziel [${target}] existiert nicht. Beende Proto-Batcher.`);
      return;
    }

    breakAndInfectNetwork(ns);

    // 1. Prüfen, ob das Ziel prepped ist
    const curSec = ns.getServerSecurityLevel(target);
    const minSec = ns.getServerMinSecurityLevel(target);
    const curMoney = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);

    if (curSec > minSec + 0.1 || curMoney < maxMoney * 0.95) {
      logger.warn(`Ziel [${target}] ist nicht prepped! Proto-Batcher pausiert kurz...`);
      patchState(ns, {
        batcherTarget: target,
        batcherProgress: `PROTO (Awaiting Prep...)`,
      });
      await ns.sleep(3000);
      continue;
    }

    // 2. Zeiten berechnen
    const tHack = ns.getHackTime(target);
    const tGrow = ns.getGrowTime(target);
    const tWeaken = ns.getWeakenTime(target);

    // Ziel-Landezeiten
    const endTimeWeaken1 = Date.now() + tWeaken;
    const endTimeHack = endTimeWeaken1 - OFFSET;
    const endTimeGrow = endTimeWeaken1 + OFFSET;
    const endTimeWeaken2 = endTimeWeaken1 + (2 * OFFSET);

    // Notwendige Start-Verzögerungen
    const delayHack = Math.max(0, endTimeHack - tHack - Date.now());
    const delayWeaken1 = Math.max(0, endTimeWeaken1 - tWeaken - Date.now());
    const delayGrow = Math.max(0, endTimeGrow - tGrow - Date.now());
    const delayWeaken2 = Math.max(0, endTimeWeaken2 - tWeaken - Date.now());

    // 3. Thread-Anzahlen (Konservativ: 10% Diebstahl)
    const stealPercent = 0.10;
    const hackThreads = Math.max(1, Math.floor(ns.hackAnalyzeThreads(target, maxMoney * stealPercent)));
    const weaken1Threads = Math.max(1, Math.ceil(ns.hackAnalyzeSecurity(hackThreads, target) / ns.weakenAnalyze(1)));
    const growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(target, 1 / (1 - stealPercent))));
    const weaken2Threads = Math.max(1, Math.ceil(ns.growthAnalyzeSecurity(growThreads, target) / ns.weakenAnalyze(1)));

    // 4. Batch im Netz starten
    const allNetwork = getAllServers(ns);
    const workerNodes = allNetwork.filter((s) => ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0);

    logger.info(`🚀 Feuere Proto-Batch auf [${target}] (H:${hackThreads}, W1:${weaken1Threads}, G:${growThreads}, W2:${weaken2Threads})`);

    executeDelayedScript(ns, workerNodes, scripts.hack, hackThreads, target, delayHack);
    executeDelayedScript(ns, workerNodes, scripts.weaken, weaken1Threads, target, delayWeaken1);
    executeDelayedScript(ns, workerNodes, scripts.grow, growThreads, target, delayGrow);
    executeDelayedScript(ns, workerNodes, scripts.weaken, weaken2Threads, target, delayWeaken2);

    patchState(ns, {
      batcherTarget: target,
      batcherProgress: `PROTO-BATCH (In Flight...)`,
    });

    // 5. Warten, bis der gesamte Batch abgeschlossen ist (Sequential Execution)
    const totalBatchDuration = tWeaken + (2 * OFFSET) + 200;
    await ns.sleep(totalBatchDuration);
  }
}

/**
 * Sucht RAM im Netz und führt ein Skript mit Verzögerung aus.
 */
function executeDelayedScript(
  ns: NS,
  workerNodes: string[],
  script: string,
  threads: number,
  target: string,
  delay: number,
): boolean {
  const ramCost = ns.getScriptRam(script, "home");

  for (const node of workerNodes) {
    if (node !== "home" && !ns.fileExists(script, node)) {
      ns.scp(script, node, "home");
    }

    const reservedRam = node === "home" ? 20 : 0;
    const maxRam = ns.getServerMaxRam(node);
    const usedRam = ns.getServerUsedRam(node);
    const freeRam = Math.max(0, maxRam - usedRam - reservedRam);

    const availableThreads = Math.floor(freeRam / ramCost);

    if (availableThreads >= threads) {
      ns.exec(script, node, threads, target, delay, Math.random());
      return true;
    }
  }

  return false;
}