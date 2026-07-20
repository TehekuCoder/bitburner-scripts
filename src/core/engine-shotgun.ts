import { NS } from "@ns";
import { getAllServers, breakAndInfectNetwork } from "../lib/network.js";
import { patchState } from "./state-manager.js";
import { Logger } from "./logger.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "ShotgunEngine", "INFO");

  // Ziel-Server über Argumente oder Fallback "n00dles"
  const target = (ns.args[0] as string) || "n00dles";

  const scripts = {
    hack: "tasks/hack.js",
    grow: "tasks/grow.js",
    weaken: "tasks/weaken.js",
  };

  logger.info(`💥 Engine-Shotgun gestartet für Ziel: [${target}]`);

  while (true) {
    if (!ns.serverExists(target)) {
      logger.error(`Ziel-Server '${target}' existiert nicht! Beende Shotgun.`);
      return;
    }

    // 1. Netzwerk aktualisieren
    breakAndInfectNetwork(ns);
    const allNetwork = getAllServers(ns);
    const workerNodes = allNetwork.filter(
      (s) => ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0,
    );

    // 2. Ziel-Zustand auslesen
    const curSec = ns.getServerSecurityLevel(target);
    const minSec = ns.getServerMinSecurityLevel(target);
    const curMoney = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);

    // Falls das Ziel stark abweicht, schalten wir kurz auf Korrektur um
    const isDePrepped = (curSec - minSec > 2.0) || (maxMoney > 0 && curMoney / maxMoney < 0.7);

    const moneyPct = maxMoney > 0 ? ((curMoney / maxMoney) * 100).toFixed(1) : "100";
    const secDelta = (curSec - minSec).toFixed(2);

    patchState(ns, {
      batcherTarget: target,
      batcherProgress: `SHOTGUN (${moneyPct}% | Sec: +${secDelta})`,
    });

    // 3. Dauerfeuer-Welle starten
    deployShotgunWave(ns, workerNodes, target, isDePrepped, scripts);

    await ns.sleep(2000);
  }
}

/**
 * Feuert eine ausgewogene Mischung aus Hack, Grow und Weaken ins Netzwerk.
 */
function deployShotgunWave(
  ns: NS,
  workerNodes: string[],
  target: string,
  isDePrepped: boolean,
  scripts: { hack: string; grow: string; weaken: string },
): void {
  const hackCost = ns.getScriptRam(scripts.hack, "home");
  const growCost = ns.getScriptRam(scripts.grow, "home");
  const weakenCost = ns.getScriptRam(scripts.weaken, "home");

  for (const node of workerNodes) {
    // Skripte kopieren
    if (node !== "home") {
      if (!ns.fileExists(scripts.hack, node)) ns.scp(scripts.hack, node, "home");
      if (!ns.fileExists(scripts.grow, node)) ns.scp(scripts.grow, node, "home");
      if (!ns.fileExists(scripts.weaken, node)) ns.scp(scripts.weaken, node, "home");
    }

    const reservedRam = node === "home" ? 20 : 0;
    const maxRam = ns.getServerMaxRam(node);
    const usedRam = ns.getServerUsedRam(node);
    const freeRam = Math.max(0, maxRam - usedRam - reservedRam);

    if (freeRam < Math.min(hackCost, growCost, weakenCost)) continue;

    if (isDePrepped) {
      // 🛠️ KORREKTUR-MODUS: 75% Grow, 25% Weaken
      const growRam = freeRam * 0.75;
      const weakenRam = freeRam * 0.25;

      const gThreads = Math.floor(growRam / growCost);
      const wThreads = Math.floor(weakenRam / weakenCost);

      if (gThreads > 0) ns.exec(scripts.grow, node, gThreads, target, 0, Math.random());
      if (wThreads > 0) ns.exec(scripts.weaken, node, wThreads, target, 0, Math.random());
    } else {
      // 💥 SHOTGUN-FEUER: 10% Hack, 50% Grow, 40% Weaken
      const hackRam = freeRam * 0.10;
      const growRam = freeRam * 0.50;
      const weakenRam = freeRam * 0.40;

      const hThreads = Math.floor(hackRam / hackCost);
      const gThreads = Math.floor(growRam / growCost);
      const wThreads = Math.floor(weakenRam / weakenCost);

      if (hThreads > 0) ns.exec(scripts.hack, node, hThreads, target, 0, Math.random());
      if (gThreads > 0) ns.exec(scripts.grow, node, gThreads, target, 0, Math.random());
      if (wThreads > 0) ns.exec(scripts.weaken, node, wThreads, target, 0, Math.random());
    }
  }
}