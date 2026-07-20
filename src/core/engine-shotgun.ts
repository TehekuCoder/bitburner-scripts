import { NS } from "@ns";
import { getAllServers, breakAndInfectNetwork } from "../lib/network.js";
import { patchState } from "./state-manager.js";
import { Logger } from "./logger.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(
    ns,
    "ShotgunEngine",
    "INFO",
    "/logs/engine-shotgun.txt",
  );

  const target = (ns.args[0] as string) || "n00dles";

  const scripts = {
    hack: "tasks/hack.js",
    grow: "tasks/grow.js",
    weaken: "tasks/weaken.js",
  };

  logger.info(`💥 Engine-Shotgun gestartet für Ziel: [${target}]`);

  let lastState: "HEALTHY" | "REPAIR" | null = null;

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

    const isDePrepped =
      curSec - minSec > 2.0 || (maxMoney > 0 && curMoney / maxMoney < 0.7);

    const moneyPctVal = maxMoney > 0 ? (curMoney / maxMoney) * 100 : 100;
    const moneyPct = moneyPctVal.toFixed(1);
    const secDeltaVal = curSec - minSec;
    const secDelta = secDeltaVal.toFixed(2);

    const isHealthy = moneyPctVal >= 85 && secDeltaVal <= 1.5;
    const currentState: "HEALTHY" | "REPAIR" =
      isDePrepped || !isHealthy ? "REPAIR" : "HEALTHY";

    // Statuswechsel loggen
    if (currentState !== lastState) {
      if (currentState === "REPAIR") {
        logger.warn(
          `⚠️ Ziel [${target}] ungesund ($: ${moneyPct}% | Sec: +${secDelta})! Schalte auf Auto-Reparatur um.`,
        );
      } else {
        logger.info(
          `🎯 Ziel [${target}] stabil ($: ${moneyPct}% | Sec: +${secDelta}). Starte Shotgun-Feuer!`,
        );
      }
      lastState = currentState;
    }

    patchState(ns, {
      batcherTarget: target,
      batcherProgress: `SHOTGUN (${moneyPct}% | Sec: +${secDelta})`,
    });

    // 3. Dauerfeuer-Welle starten
    deployShotgunWave(
      ns,
      workerNodes,
      target,
      currentState === "REPAIR",
      scripts,
      logger,
    );

    await ns.sleep(2000);
  }
}

/**
 * Verteilt Threads effizient auf alle verfügbaren Worker-Nodes ohne RAM-Verschnitt.
 */
function deployShotgunWave(
  ns: NS,
  workerNodes: string[],
  target: string,
  isRepairing: boolean,
  scripts: { hack: string; grow: string; weaken: string },
  logger: Logger,
): void {
  if (workerNodes.length === 0) return;

  const hCost = ns.getScriptRam(scripts.hack, "home");
  const gCost = ns.getScriptRam(scripts.grow, "home");
  const wCost = ns.getScriptRam(scripts.weaken, "home");
  const minCost = Math.min(hCost, gCost, wCost);

  let totalHackThreads = 0;
  let totalGrowThreads = 0;
  let totalWeakenThreads = 0;
  let activeNodes = 0;

  for (const node of workerNodes) {
    if (node !== "home") {
      for (const scriptPath of Object.values(scripts)) {
        if (!ns.fileExists(scriptPath, node)) {
          ns.scp(scriptPath, node, "home");
        }
      }
    }

    const maxRam = ns.getServerMaxRam(node);
    const usedRam = ns.getServerUsedRam(node);
    const reservedRam = node === "home" ? Math.min(20, maxRam * 0.2) : 0;
    let freeRam = Math.max(0, maxRam - usedRam - reservedRam);

    if (freeRam < minCost) continue;

    let hThreads = 0;
    let gThreads = 0;
    let wThreads = 0;

    if (isRepairing) {
      // 🛠️ REPARATUR-VERHÄLTNIS: 4x Grow (80%), 1x Weaken (20%)
      const unitCost = 4 * gCost + 1 * wCost;
      const units = Math.floor(freeRam / unitCost);

      if (units > 0) {
        gThreads += units * 4;
        wThreads += units * 1;
        freeRam -= units * unitCost;
      }

      // Rest-RAM gierig auffüllen (Erst Grow, dann Weaken)
      while (freeRam >= gCost) {
        gThreads++;
        freeRam -= gCost;
      }
      while (freeRam >= wCost) {
        wThreads++;
        freeRam -= wCost;
      }
    } else {
      // 💥 SHOTGUN-VERHÄLTNIS: 1x Hack (10%), 5x Grow (50%), 4x Weaken (40%)
      const unitCost = 1 * hCost + 5 * gCost + 4 * wCost;
      const units = Math.floor(freeRam / unitCost);

      if (units > 0) {
        hThreads += units * 1;
        gThreads += units * 5;
        wThreads += units * 4;
        freeRam -= units * unitCost;
      }

      // Rest-RAM gierig auffüllen (Weaken -> Grow -> Hack)
      while (freeRam >= wCost) {
        wThreads++;
        freeRam -= wCost;
      }
      while (freeRam >= gCost) {
        gThreads++;
        freeRam -= gCost;
      }
      while (freeRam >= hCost) {
        hThreads++;
        freeRam -= hCost;
      }
    }

    // Skripte ausführen
    let nodeUsed = false;
    if (hThreads > 0 && ns.exec(scripts.hack, node, hThreads, target, 0, Math.random()) > 0) {
      totalHackThreads += hThreads;
      nodeUsed = true;
    }
    if (gThreads > 0 && ns.exec(scripts.grow, node, gThreads, target, 0, Math.random()) > 0) {
      totalGrowThreads += gThreads;
      nodeUsed = true;
    }
    if (wThreads > 0 && ns.exec(scripts.weaken, node, wThreads, target, 0, Math.random()) > 0) {
      totalWeakenThreads += wThreads;
      nodeUsed = true;
    }

    if (nodeUsed) activeNodes++;
  }

  const grandTotal = totalHackThreads + totalGrowThreads + totalWeakenThreads;

  if (grandTotal > 0) {
    logger.info(
      `🌊 Welle gefeuert [${isRepairing ? "REPARATUR" : "SHOTGUN"}] | Nodes: ${activeNodes}/${workerNodes.length} | Threads -> H: ${totalHackThreads} | G: ${totalGrowThreads} | W: ${totalWeakenThreads}`,
    );
  } else {
    // Nur noch als DEBUG-Log, um das Terminal/Logfile nicht zu spamen, wenn die alten Wellen noch laufen
    logger.debug(`⏳ Welle abgewartet – Netzwerk-RAM aktuell noch voll ausgelastet.`);
  }
}