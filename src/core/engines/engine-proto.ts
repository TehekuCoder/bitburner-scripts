import { NS } from "@ns";
import { breakAndInfectNetwork, getAllServers } from "/lib/network.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { patchBatcherState } from "/lib/state.js";
import { PATHS } from "/lib/paths";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "ProtoEngine");

  const target = (ns.args[0] as string) || "joesguns";

  const hackScript = PATHS.payloads.hack;
  const growScript = PATHS.payloads.grow;
  const weakenScript = PATHS.payloads.weaken;

  logger.info(`⚡ Proto-Engine (Early Cashflow) gestartet für: [${target}]`);

  while (true) {
    if (!ns.serverExists(target)) return;

    breakAndInfectNetwork(ns);
    const workerNodes = getAllServers(ns).filter(
      (s) => ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0
    );

    const curSec = ns.getServerSecurityLevel(target);
    const minSec = ns.getServerMinSecurityLevel(target);
    const curMoney = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);

    const secDelta = curSec - minSec;
    const moneyRatio = maxMoney > 0 ? curMoney / maxMoney : 1;

    // Dashboard-Status Update
    patchBatcherState(ns, {
      batcherTarget: target,
      batcherProgress: `PROTO-CASH (Money: ${(moneyRatio * 100).toFixed(0)}% | Sec: +${secDelta.toFixed(1)})`,
    });

    // Worker verteilen
    deployProtoWorkers(
      ns,
      workerNodes,
      target,
      secDelta,
      moneyRatio,
      hackScript,
      growScript,
      weakenScript
    );

    await ns.sleep(2000);
  }
}

function deployProtoWorkers(
  ns: NS,
  workerNodes: string[],
  target: string,
  secDelta: number,
  moneyRatio: number,
  hackScript: string,
  growScript: string,
  weakenScript: string
): void {
  const hCost = ns.getScriptRam(hackScript, "home");
  const gCost = ns.getScriptRam(growScript, "home");
  const wCost = ns.getScriptRam(weakenScript, "home");

  for (const node of workerNodes) {
    if (node !== "home") {
      if (!ns.fileExists(hackScript, node)) ns.scp(hackScript, node, "home");
      if (!ns.fileExists(growScript, node)) ns.scp(growScript, node, "home");
      if (!ns.fileExists(weakenScript, node)) ns.scp(weakenScript, node, "home");
    }

    const maxRam = ns.getServerMaxRam(node);
    const usedRam = ns.getServerUsedRam(node);
    const reservedRam = node === "home" ? Math.min(16, maxRam * 0.2) : 0;
    const freeRam = Math.max(0, maxRam - usedRam - reservedRam);

    if (freeRam < wCost) continue;

    // STUFE 1: Sicherheit ist zu hoch -> Fokus auf Weaken
    if (secDelta > 3.0) {
      const threads = Math.floor(freeRam / wCost);
      if (threads > 0) ns.exec(weakenScript, node, threads, target, 0, Math.random());
    } 
    // STUFE 2: Geld ist niedrig -> Grow + Weaken
    else if (moneyRatio < 0.6) {
      const gThreads = Math.floor((freeRam * 0.8) / gCost);
      const wThreads = Math.floor((freeRam * 0.2) / wCost);

      if (gThreads > 0) ns.exec(growScript, node, gThreads, target, 0, Math.random());
      if (wThreads > 0) ns.exec(weakenScript, node, wThreads, target, 0, Math.random());
    } 
    // STUFE 3: Cashflow-Modus -> Hack + Grow + Weaken gleichzeitig!
    else {
      const hThreads = Math.floor((freeRam * 0.25) / hCost);
      const gThreads = Math.floor((freeRam * 0.55) / gCost);
      const wThreads = Math.floor((freeRam * 0.20) / wCost);

      if (hThreads > 0) ns.exec(hackScript, node, hThreads, target, 0, Math.random());
      if (gThreads > 0) ns.exec(growScript, node, gThreads, target, 0, Math.random());
      if (wThreads > 0) ns.exec(weakenScript, node, wThreads, target, 0, Math.random());
    }
  }
}