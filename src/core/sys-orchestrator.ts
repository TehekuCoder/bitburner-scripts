import { NS } from "@ns";
import { getAllServers } from "../lib/network.js";
import { getNetworkMaxRam } from "../lib/ram-utils.js";
import { Logger } from "./logger.js";
import { patchState } from "./state-manager.js";
import { BatchStrategy } from "./types.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(
    ns,
    "Orchestrator",
    "INFO",
    "/logs/sys-orchestrator.txt",
  );

  const DASHBOARD_SCRIPT = "core/sys-jit-batcher-dashboard.js";

  let activeStrategy: BatchStrategy | null = null;
  let activeTarget: string | null = null;
  let activeProcessId = 0;

  while (true) {
    const servers = getAllServers(ns);
    const totalMaxRam = getNetworkMaxRam(ns, servers);
    const target = selectBestTarget(ns, servers);

    // 1. Strategie evaluieren
    const desiredStrategy = determineStrategy(
      ns,
      totalMaxRam,
      target,
      activeStrategy,
    );

    // 2. Prüfen, ob ein Wechsel erforderlich ist (Strategiewechsel, Zielwechsel ODER Prozess abgestürzt)
    const strategyChanged = desiredStrategy !== activeStrategy;
    const targetChanged = target !== activeTarget;
    const processDied = activeProcessId > 0 && !ns.isRunning(activeProcessId);

    if (strategyChanged || targetChanged || processDied) {
      logger.info(
        `🔄 Statuswechsel: Strategie [${activeStrategy ?? "NONE"} ➡️ ${desiredStrategy}] | Ziel [${activeTarget ?? "NONE"} ➡️ ${target ?? "NONE"}]`,
      );

      // Laufende Alt-Prozesse sauber beenden
      if (activeProcessId > 0 && ns.isRunning(activeProcessId)) {
        ns.kill(activeProcessId);
      }

      // Ziel-Skript starten
      activeProcessId = switchExecutionEngine(ns, desiredStrategy, target);
      activeStrategy = desiredStrategy;
      activeTarget = target;

      // State für Dashboard und Dispatcher aktualisieren
      patchState(ns, {
        batchStrategy: desiredStrategy,
        kernelTarget: target ?? "n00dles",
      });
    }

    // 3. DASHBOARD LIFECYCLE MANAGEMENT
    if (activeStrategy === "JIT_HWGW") {
      if (
        ns.fileExists(DASHBOARD_SCRIPT, "home") &&
        !ns.isRunning(DASHBOARD_SCRIPT, "home")
      ) {
        const freeRam =
          ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
        const reqRam = ns.getScriptRam(DASHBOARD_SCRIPT, "home");

        if (freeRam >= reqRam) {
          ns.run(DASHBOARD_SCRIPT, 1);
          logger.info(`📊 JIT-Batcher Dashboard gestartet.`);
        }
      }
    } else {
      if (ns.isRunning(DASHBOARD_SCRIPT, "home")) {
        ns.scriptKill(DASHBOARD_SCRIPT, "home");
        logger.info(`⏹️ JIT-Batcher Dashboard beendet (Inaktive Strategie).`);
      }
    }

    await ns.sleep(5000); // Evaluierungs-Intervall
  }
}

/**
 * Kernlogik: Wählt die richtige Batch/Prep-Strategie basierend auf Netzwerk- und Home-Metriken.
 */
function determineStrategy(
  ns: NS,
  totalRam: number,
  target: string | null,
  currentStrategy: BatchStrategy | null,
): BatchStrategy {
  // 1. Extrem wenig RAM (Frisch nach Augmentation Reset)
  if (totalRam < 64) {
    return "BOOTSTRAP";
  }

  if (!target) return "PREP";

  // 🧠 SHOTGUN & JIT REGEL: Kontinuierliche Engines nicht grundlos unterbrechen
  if (currentStrategy === "SHOTGUN_HWGW" || currentStrategy === "JIT_HWGW") {
    const sObj = ns.getServer(target);
    const curDiff = sObj.hackDifficulty ?? 99;
    const minDiff = sObj.minDifficulty ?? 1;

    // Nur abbrechen, wenn die Security völlig aus dem Ruder läuft (z.B. +20 über Min)
    const isTotallyNuked = curDiff - minDiff > 20.0;
    if (!isTotallyNuked) {
      return currentStrategy;
    }
  }

  const sObj = ns.getServer(target);
  const currentDiff = sObj.hackDifficulty ?? 99;
  const minDiff = sObj.minDifficulty ?? 1;
  const currentMoney = sObj.moneyAvailable ?? 0;
  const maxMoney = sObj.moneyMax ?? 1;

  const isPrepped =
    currentDiff - minDiff <= 0.05 &&
    (maxMoney > 0 ? currentMoney / maxMoney >= 0.98 : true);

  if (!isPrepped) {
    return "PREP";
  }

  const homeRam = ns.getServerMaxRam("home");
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  if (totalRam < 1024) {
    return "PROTO_BATCH";
  } else if (totalRam < 16384 || homeRam < 4096 || !hasFormulas) {
    return "SHOTGUN_HWGW";
  } else {
    return "JIT_HWGW";
  }
}

/**
 * Startet das jeweilige Sub-System als isolierten Prozess.
 */
function switchExecutionEngine(
  ns: NS,
  strategy: BatchStrategy,
  target: string | null,
): number {
  const targetArg = target ?? "n00dles";

  switch (strategy) {
    case "BOOTSTRAP":
      // Nutzt im Bootstrap-Fall vorerst die Prep-Engine auf n00dles
      return ns.run("core/engine-prep.js", 1, "n00dles");

    case "XP_GRIND":
      return ns.run("core/engine-xp-grind.js", 1, "joesguns");

    case "PREP":
      return ns.run("core/engine-prep.js", 1, targetArg);

    case "PROTO_BATCH":
      return ns.run("core/engine-proto.js", 1, targetArg);

    case "SHOTGUN_HWGW":
      return ns.run("core/engine-shotgun.js", 1, targetArg);

    case "JIT_HWGW":
      return ns.run("core/sys-jit-batcher.js", 1, targetArg);

    default:
      return 0;
  }
}

function selectBestTarget(ns: NS, servers: string[]): string | null {
  const playerSkill = ns.getPlayer().skills.hacking;

  return (
    servers
      .filter(
        (s) =>
          ns.hasRootAccess(s) &&
          ns.getServerMaxMoney(s) > 0 &&
          (ns.getServerRequiredHackingLevel(s) ?? 0) <= playerSkill / 2,
      )
      .sort(
        (a, b) =>
          (ns.getServerMaxMoney(b) ?? 0) - (ns.getServerMaxMoney(a) ?? 0),
      )[0] ?? "n00dles"
  );
}
