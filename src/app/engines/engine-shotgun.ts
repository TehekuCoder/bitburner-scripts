import { NS } from "@ns";
import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";
import { PATHS } from "../../infrastructure/runtime/paths.js";
import { getAllServers } from "/infrastructure/network/network.js";
import { getWorkerFreeRam } from "/infrastructure/network/network.js";
import { patchBatcherState } from "/infrastructure/state/state.js";
import { formatPercent, loadBnMults } from "/lib/utils.js";
import {
  GROW_SECURITY_PER_THREAD,
  HACK_SECURITY_PER_THREAD,
  getWeakenEffectPerThread,
  getWeakenThreadsForSecurity,
} from "/domain/hacking/weaken.js";
import { ensureScriptsOnServer } from "/domain/hacking/provision.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "ShotgunEngine");

  const target = (ns.args[0] as string) || "n00dles";

  const scripts = {
    hack: PATHS.services.payloads.hack,
    grow: PATHS.services.payloads.grow,
    weaken: PATHS.services.payloads.weaken,
  };

  logger.info(`💥 Engine-Shotgun gestartet für Ziel: [${target}]`);

  // Startzustand: Wenn wir neu starten, gehen wir erst von REPARATUR aus
  let currentState: "HEALTHY" | "REPAIR" = "REPAIR";
  let lastLoggedState: "HEALTHY" | "REPAIR" | null = null;
  const weakenEffectPerThread = getWeakenEffectPerThread(
    loadBnMults(ns).ServerWeakenRate,
  );
  if (weakenEffectPerThread <= 0) {
    logger.error("ServerWeakenRate ist 0; Shotgun kann Security nicht ausgleichen.");
    return;
  }

  while (true) {
    if (!ns.serverExists(target)) {
      logger.error(`Ziel-Server '${target}' existiert nicht! Beende Shotgun.`);
      return;
    }

    // 1. Netzwerk aktualisieren
    const allNetwork = getAllServers(ns);
    const workerNodes = allNetwork.filter(
      (s) => ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0,
    );

    // 2. Ziel-Zustand auslesen
    const curSec = ns.getServerSecurityLevel(target);
    const minSec = ns.getServerMinSecurityLevel(target);
    const curMoney = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);

    const moneyPctVal = maxMoney > 0 ? (curMoney / maxMoney) * 100 : 100;
    const moneyPct = formatPercent(moneyPctVal, 100, 1);
    const secDeltaVal = curSec - minSec;
    const secDelta = secDeltaVal.toFixed(2);

    // 🎯 HYSTERESE-LOGIK (Puffer gegen Jojo-Effekt):
    // - Schalte auf REPARATUR um, wenn Geld unter 70% fällt ODER Security > +2.5 steigt
    // - Erst wieder zurück auf HEALTHY, wenn Geld wieder >= 92% UND Security <= +0.5 ist!
    if (currentState === "HEALTHY") {
      if (moneyPctVal < 70.0 || secDeltaVal > 2.5) {
        currentState = "REPAIR";
      }
    } else {
      if (moneyPctVal >= 92.0 && secDeltaVal <= 0.5) {
        currentState = "HEALTHY";
      }
    }

    // Statuswechsel im Log ausgeben
    if (currentState !== lastLoggedState) {
      if (currentState === "REPAIR") {
        logger.warn(
          `⚠️ Ziel [${target}] ungesund ($: ${moneyPct}% | Sec: +${secDelta})! Schalte auf Auto-Reparatur um.`,
        );
      } else {
        logger.info(
          `🎯 Ziel [${target}] stabil ($: ${moneyPct}% | Sec: +${secDelta}). Starte Shotgun-Feuer!`,
        );
      }
      lastLoggedState = currentState;
    }

    await patchBatcherState(ns, {
      batchStrategy: "SHOTGUN_HWGW",
      batcherActive: true,
      batcherTarget: target,
      batcherProgress: `SHOTGUN (${moneyPct}% | Sec: +${secDelta})`,
    });

    // 3. Dauerfeuer-Welle starten
    await deployShotgunWave(
      ns,
      workerNodes,
      target,
      currentState === "REPAIR",
      scripts,
      logger,
      weakenEffectPerThread,
    );

    await ns.sleep(2000);
  }
}

/**
 * Verteilt Threads effizient auf alle verfügbaren Worker-Nodes ohne RAM-Verschnitt.
 */
async function deployShotgunWave(
  ns: NS,
  workerNodes: string[],
  target: string,
  isRepairing: boolean,
  scripts: { hack: string; grow: string; weaken: string },
  logger: Logger,
  weakenEffectPerThread: number,
): Promise<void> {
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
    if (!(await ensureScriptsOnServer(ns, node, Object.values(scripts)))) {
      continue;
    }
    let freeRam = getWorkerFreeRam(ns, node);

    if (freeRam < minCost) continue;

    let hThreads = 0;
    let gThreads = 0;
    let wThreads = 0;

    if (isRepairing) {
      const growPerWeaken = Math.max(
        1,
        Math.floor(weakenEffectPerThread / GROW_SECURITY_PER_THREAD),
      );
      const weakenPerGrow =
        weakenEffectPerThread < GROW_SECURITY_PER_THREAD
          ? Math.ceil(GROW_SECURITY_PER_THREAD / weakenEffectPerThread)
          : 0;
      const unitGrowThreads = weakenPerGrow > 0 ? 1 : growPerWeaken;
      const unitWeakenThreads =
        weakenPerGrow > 0 ? weakenPerGrow : 1;
      const unitCost =
        unitGrowThreads * gCost + unitWeakenThreads * wCost;
      const units = Math.floor(freeRam / unitCost);

      if (units > 0) {
        gThreads += units * unitGrowThreads;
        wThreads += units * unitWeakenThreads;
        freeRam -= units * unitCost;
      }

      wThreads += Math.floor(freeRam / wCost);
    } else {
      const unitWeakenThreads = getWeakenThreadsForSecurity(
        HACK_SECURITY_PER_THREAD + 5 * GROW_SECURITY_PER_THREAD,
        weakenEffectPerThread,
      );
      const unitCost = hCost + 5 * gCost + unitWeakenThreads * wCost;
      const units = Math.floor(freeRam / unitCost);

      if (units > 0) {
        hThreads += units * 1;
        gThreads += units * 5;
        wThreads += units * unitWeakenThreads;
        freeRam -= units * unitCost;
      }

      const growWeakenThreads = getWeakenThreadsForSecurity(
        GROW_SECURITY_PER_THREAD,
        weakenEffectPerThread,
      );
      const safeGrowCost = gCost + growWeakenThreads * wCost;
      while (freeRam >= safeGrowCost) {
        gThreads++;
        wThreads += growWeakenThreads;
        freeRam -= safeGrowCost;
      }
      if (freeRam >= wCost) {
        wThreads += Math.floor(freeRam / wCost);
      }
    }

    const launched: number[] = [];
    if (hThreads > 0) {
      launched.push(
        ns.exec(scripts.hack, node, hThreads, target, 0, Math.random()),
      );
    }
    if (gThreads > 0) {
      launched.push(
        ns.exec(scripts.grow, node, gThreads, target, 0, Math.random()),
      );
    }
    if (wThreads > 0) {
      launched.push(
        ns.exec(scripts.weaken, node, wThreads, target, 0, Math.random()),
      );
    }

    if (launched.length > 0 && launched.every((pid) => pid > 0)) {
      totalHackThreads += hThreads;
      totalGrowThreads += gThreads;
      totalWeakenThreads += wThreads;
      activeNodes++;
    } else {
      for (const pid of launched) {
        if (pid > 0) ns.kill(pid);
      }
    }
  }

  const grandTotal = totalHackThreads + totalGrowThreads + totalWeakenThreads;

  if (grandTotal > 0) {
    logger.info(
      `🌊 Welle gefeuert [${isRepairing ? "REPARATUR" : "SHOTGUN"}] | Nodes: ${activeNodes}/${workerNodes.length} | Threads -> H: ${totalHackThreads} | G: ${totalGrowThreads} | W: ${totalWeakenThreads}`,
    );
  } else {
    logger.debug(
      `⏳ Welle abgewartet – Netzwerk-RAM aktuell noch voll ausgelastet.`,
    );
  }
}
