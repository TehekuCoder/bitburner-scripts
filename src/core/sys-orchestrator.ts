import { NS } from "@ns";
import { getAllServers } from "../lib/network.js";
import { getNetworkMaxRam } from "../lib/ram-utils.js";
import { Logger } from "./logger.js";
import { patchState } from "./state-manager.js";

export enum Strategy {
  XP_GRIND = "XP_GRIND", // Fokus auf Hacking XP
  PREP = "PREP", // Server auf S_min / M_max bringen
  PROTO_BATCH = "PROTO_BATCH", // Single-Batch HWGW
  SHOTGUN_HWGW = "SHOTGUN_HWGW", // Multi-Batch statisch
  JIT_HWGW = "JIT_HWGW", // Dynamische JIT-Queue
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(
    ns,
    "Orchestrator",
    "INFO",
    "/logs/sys-orchestrator.txt",
  );

  const DASHBOARD_SCRIPT = "core/sys-jit-batcher-dashboard.js";

  let activeStrategy: Strategy | null = null;
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

    // 🟢 3. DASHBOARD LIFECYCLE MANAGEMENT
    if (activeStrategy === Strategy.JIT_HWGW) {
      // Dashboard starten, falls es noch nicht läuft und genug RAM da ist
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
      // Dashboard beenden, wenn wir in einer anderen Strategie (wie PREP oder SHOTGUN) sind
      if (ns.isRunning(DASHBOARD_SCRIPT, "home")) {
        ns.scriptKill(DASHBOARD_SCRIPT, "home");
        logger.info(`⏹️ JIT-Batcher Dashboard beendet (Inaktive Strategie).`);
      }
    }

    await ns.sleep(5000); // Evaluierungs-Intervall (5s ist etwas reaktiver als 10s)
  }
}

/**
 * Kernlogik: Wählt die richtige Batch/Prep-Strategie basierend auf Netzwerk- und Home-Metriken.
 */
function determineStrategy(
  ns: NS,
  totalRam: number,
  target: string | null,
  currentStrategy: Strategy | null, // 👈 Aktuelle Strategie mit übergeben!
): Strategy {
  const homeRam = ns.getServerMaxRam("home");
  const hasFormulas = ns.fileExists("Formulas.exe", "home");

  if (!target) return Strategy.PREP;

  const sObj = ns.getServer(target);
  const currentDiff = sObj.hackDifficulty ?? 99;
  const minDiff = sObj.minDifficulty ?? 1;
  const currentMoney = sObj.moneyAvailable ?? 0;
  const maxMoney = sObj.moneyMax ?? 1;

  // 🧠 HYSTERESE-LOGIK:
  // Wenn wir SCHON im Batch-Betrieb sind, sind wir toleranter!
  const isBatching = [
    Strategy.PROTO_BATCH,
    Strategy.SHOTGUN_HWGW,
    Strategy.JIT_HWGW,
  ].includes(currentStrategy!);

  const secThreshold = isBatching ? minDiff + 2.0 : minDiff + 0.05; // Batcher darf bis +2.0 Sec arbeiten
  const moneyThreshold = isBatching ? maxMoney * 0.8 : maxMoney * 0.98; // Batcher darf bis 80% Geld arbeiten

  const isPrepped =
    currentDiff <= secThreshold && currentMoney >= moneyThreshold;

  // 1. Ziel ausserhalb der Toleranz -> PREP Mode
  if (!isPrepped) {
    return Strategy.PREP;
  }

  // 2. Ziel bereit -> Wahl des Batchers
  if (totalRam < 1024) {
    return Strategy.PROTO_BATCH;
  } else if (totalRam < 16384 || homeRam < 4096 || !hasFormulas) {
    return Strategy.SHOTGUN_HWGW;
  } else {
    return Strategy.JIT_HWGW;
  }
}
/**
 * Startet das jeweilige Sub-System als isolierten Prozess.
 */
function switchExecutionEngine(
  ns: NS,
  strategy: Strategy,
  target: string | null,
): number {
  const targetArg = target ?? "n00dles";

  switch (strategy) {
    case Strategy.XP_GRIND:
      return ns.run("core/engine-xp-grind.js", 1, "joesguns");

    case Strategy.PREP:
      return ns.run("core/engine-prep.js", 1, targetArg);

    case Strategy.PROTO_BATCH:
      return ns.run("core/engine-proto.js", 1, targetArg);

    case Strategy.SHOTGUN_HWGW:
      return ns.run("core/engine-shotgun.js", 1, targetArg);

    case Strategy.JIT_HWGW:
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
