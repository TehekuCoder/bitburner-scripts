import { NS } from "@ns";
import { getAllServers, breakAndInfectNetwork } from "../lib/network.js";
import { patchState } from "./state-manager.js";
import { Logger } from "./logger.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "PrepEngine", "INFO");

  // Ziel-Server kann via CLI/Orchestrator übergeben werden (z.B. ns.run("core/engine-prep.js", 1, "n00dles"))
  const target = (ns.args[0] as string) || "n00dles";

  const weakenScript = "tasks/weaken.js";
  const growScript = "tasks/grow.js";

  logger.info(`🔥 Engine-Prep gestartet für Ziel: [${target}]`);

  while (true) {
    if (!ns.serverExists(target)) {
      logger.error(`Ziel-Server '${target}' existiert nicht! Beende Prep.`);
      return;
    }

    // 1. Netzwerk aktualisieren & Infizieren
    breakAndInfectNetwork(ns);
    const allNetwork = getAllServers(ns);
    const pServers = ns.cloud.getServerNames();

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

    // 🟢 ZIEL IST PREPPED!
    if (isSecMin && isMoneyMax) {
      logger.success(`✅ Ziel [${target}] ist vollständig PREPPED!`);
      
      patchState(ns, {
        batcherTarget: target,
        batcherProgress: "PREPPED 100%",
      });

      // Sauber aufräumen
      stopAllWorkers(ns, workerNodes, [weakenScript, growScript]);
      
      // Kurz warten, damit der Orchestrator auf Shotgun/Batcher umschalten kann
      await ns.sleep(3000);
      continue;
    }

    // Status ins Dashboard / State schreiben
    const moneyPct = maxMoney > 0 ? ((curMoney / maxMoney) * 100).toFixed(1) : "100";
    const secStatus = `+${secDelta.toFixed(2)}`;
    patchState(ns, {
      batcherTarget: target,
      batcherProgress: `PREP (Money: ${moneyPct}% | Sec: ${secStatus})`,
    });

    // 3. Modus bestimmen: Nur WEAKEN oder GROW + WEAKEN?
    let mode: "WEAKEN_ONLY" | "GROW_AND_WEAKEN" = "GROW_AND_WEAKEN";
    if (secDelta > 0.5 || !isSecMin) {
      mode = "WEAKEN_ONLY";
    }

    // 4. Thread-Verteilung auf dem Netzwerk durchführen
    deployPrepWorkers(ns, workerNodes, target, mode, weakenScript, growScript);

    await ns.sleep(2000);
  }
}

/**
 * Verteilt Weaken/Grow-Prozesse effizient über das gesamte RAM-Netzwerk.
 */
function deployPrepWorkers(
  ns: NS,
  workerNodes: string[],
  target: string,
  mode: "WEAKEN_ONLY" | "GROW_AND_WEAKEN",
  weakenScript: string,
  growScript: string,
): void {
  const weakenCost = ns.getScriptRam(weakenScript, "home");
  const growCost = ns.getScriptRam(growScript, "home");

  for (const node of workerNodes) {
    // Skripte auf Zielknoten kopieren falls nötig
    if (node !== "home") {
      if (!ns.fileExists(weakenScript, node)) ns.scp(weakenScript, node, "home");
      if (!ns.fileExists(growScript, node)) ns.scp(growScript, node, "home");
    }

    // Reservierter RAM für Home (damit System-Skripte nicht blockiert werden)
    const reservedRam = node === "home" ? 20 : 0;
    const maxRam = ns.getServerMaxRam(node);
    const usedRam = ns.getServerUsedRam(node);
    const freeRam = Math.max(0, maxRam - usedRam - reservedRam);

    if (freeRam < Math.min(weakenCost, growCost)) continue;

    if (mode === "WEAKEN_ONLY") {
      const threads = Math.floor(freeRam / weakenCost);
      if (threads > 0) {
        ns.exec(weakenScript, node, threads, target, 0, Math.random());
      }
    } else {
      // GROW_AND_WEAKEN: Verhältnis ca. 80% Grow / 20% Weaken
      const growRam = freeRam * 0.8;
      const weakenRam = freeRam * 0.2;

      const growThreads = Math.floor(growRam / growCost);
      const weakenThreads = Math.floor(weakenRam / weakenCost);

      if (growThreads > 0) {
        ns.exec(growScript, node, growThreads, target, 0, Math.random());
      }
      if (weakenThreads > 0) {
        ns.exec(weakenScript, node, weakenThreads, target, 0, Math.random());
      }
    }
  }
}

/**
 * Beendet laufende Prep-Worker auf allen Knoten.
 */
function stopAllWorkers(ns: NS, workerNodes: string[], scripts: string[]): void {
  for (const node of workerNodes) {
    for (const proc of ns.ps(node)) {
      if (scripts.includes(proc.filename)) {
        ns.kill(proc.pid);
      }
    }
  }
}