import { NS, FactionName } from "@ns";

import { generateProgressBar } from "../ui/ui-helper.js";
import {
  DEFAULT_MULTIPLIERS,
  PATH_HACK,
  PATH_GROW,
  PATH_WEAKEN,
  REFRESH_INTERVALS,
  COMBAT_STATS,
} from "/lib/constants.js";
import { Logger } from "/lib/logger.js";
import { MetricTracker } from "/lib/metrics.js";
import {
  breakAndInfectNetwork,
  getAllServers,
  findBestTarget,
} from "/lib/network.js";
import {
  findNextRoadmapFaction,
  applyToAllMegacorps,
  determineStrategy,
} from "/lib/player.js";
import { loadBnMults, loadState, patchState } from "/lib/state.js";
import { ScriptList, BotStrategy } from "/lib/types.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Dispatcher", "INFO");

  if (ns.singularity === undefined) {
    logger.error("Kritischer Systemfehler: Singularity-API (SF4) fehlt!");
    ns.tprint(
      "🛑 [Dispatcher] Kritischer Fehler: Singularity-API (SF4) fehlt!",
    );
    return;
  }

  logger.info("Initialisiere Dispatcher & Lade Multiplikatoren...");
  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;

  const metricTracker = new MetricTracker();

  let cachedFallbackTarget = "n00dles";
  let lastFallbackUpdate = 0;
  let modeLockTime = 0;
  let lastCorpApplication = 0;

  let allNetworkServers: string[] = [];
  let lastNetworkScan = 0;

  const scripts: ScriptList = {
    worker: "payloads/work.js",
    dispatcher: "core/sys-dispatcher.js",
    infra: "managers/infra-manager.js",
    backdoor: "daemons/backdoor.js",
    trade: "manager/finance-manager.js",
    hacknet: "daemons/hacknet-early.js",
    dnet: "manager/dnet-master.js",
    crawler: "tasks/dnet-crawler.js",
    hack: PATH_HACK,
    grow: PATH_GROW,
    weaken: PATH_WEAKEN,
    sleeve: "managers/sleeve-manager.js",
    fillShare: "daemons/fill-share.js",
  };

  const sysOrchestratorScript = "core/sys-orchestrator.js";

  let lastAugAnalysis = 0;

  while (true) {
    const now = Date.now();

    // 1. Periodischer Netzwerk-Scan & Infektion
    if (
      now - lastNetworkScan > REFRESH_INTERVALS.NETWORK_SCAN ||
      allNetworkServers.length === 0
    ) {
      breakAndInfectNetwork(ns);
      allNetworkServers = getAllServers(ns);
      lastNetworkScan = now;
    }

    const currentState = loadState(ns);
    const factionTargets = (currentState?.factionTargets ?? {}) as Partial<
      Record<FactionName, number>
    >;

    // Periodische Augment-Analyse (alle 5 Minuten oder bei Neustart)
    if (now - lastAugAnalysis > 300_000 || !currentState?.augRoadmap) {
      if (ns.fileExists("tasks/analyze-augmentations.js", "home")) {
        ns.run("tasks/analyze-augmentations.js", 1);
        lastAugAnalysis = now;
      }
    }

    // Fraktions-Ziel über Roadmap ermitteln
    const augRoadmap = currentState?.augRoadmap ?? [];
    const nextRoadmapFaction = findNextRoadmapFaction(ns, augRoadmap);

    const p = ns.getPlayer();

    // 2. Fraktions-Reputationen & Roadmap evaluieren
    const currentFactionReps: Record<string, number> = {};
    for (const f of p.factions) {
      currentFactionReps[f] = ns.singularity.getFactionRep(f);
    }
    if (nextRoadmapFaction) {
      factionTargets[nextRoadmapFaction.name] = nextRoadmapFaction.targetRep;
    }

    const homeMaxRam = ns.getServerMaxRam("home");
    const getFreeRam = () =>
      ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
    const currentKarma = (ns as any).heart?.break() ?? 0;

    // 3. Megacorp-Bewerbungen prüfen
    if (
      p.skills.hacking >= 250 &&
      now - lastCorpApplication > REFRESH_INTERVALS.MEGACORP_APPLY
    ) {
      applyToAllMegacorps(ns, p, logger);
      lastCorpApplication = now;
    }

    const pServers = ns.cloud.getServerNames();
    const hasFormulas = ns.fileExists("Formulas.exe", "home");

    // 4. Finanz- & Strategie-Schwellenwerte berechnen
    const playerMoney = p.money;
    const factionRepMult = bnMults.FactionWorkRepGain ?? 1;
    const crimeMoneyMult = bnMults.CrimeMoney ?? 1;

    const activeBatchStrategy = currentState?.batchStrategy;
    const isBatcherActive =
      activeBatchStrategy === "SHOTGUN_HWGW" ||
      activeBatchStrategy === "JIT_HWGW";

    let BASE_MONEY_THRESHOLD = factionRepMult < 0.5 ? 50_000_000 : 10_000_000;

    if (
      nextRoadmapFaction?.name === "CyberSec" ||
      nextRoadmapFaction?.name === "Tian Di Hui" ||
      nextRoadmapFaction?.name === "Netburners"
    ) {
      BASE_MONEY_THRESHOLD = 1_000_000;
    }

    const lastStrategy = currentState?.strategy || "MONEY";
    const effectiveThreshold =
      lastStrategy === "REP"
        ? BASE_MONEY_THRESHOLD * 0.7
        : BASE_MONEY_THRESHOLD;

    const isReadyForFactionGrind =
      isBatcherActive || playerMoney > effectiveThreshold;

    const factionToWorkFor = factionRepMult > 0.1 ? nextRoadmapFaction : null;
    const hasSavingTarget =
      factionToWorkFor !== null && !isReadyForFactionGrind;

    const isOrchestratorRunning = ns.isRunning(sysOrchestratorScript, "home");

    // 5. Strategie ermitteln
    const strategy = determineStrategy(
      ns,
      p,
      currentState,
      bnMults,
      currentKarma,
      isOrchestratorRunning,
      factionTargets as Record<FactionName, number>,
      nextRoadmapFaction, // 👈 Type-Cast verhindert mismatch mit altem FactionConfig-Interface
      factionToWorkFor,
      isReadyForFactionGrind,
    );

    let { mode, targetFaction, targetCompany, targetStat } = strategy;

    // 6. Fallback-Target ermitteln
    if (
      now - lastFallbackUpdate > REFRESH_INTERVALS.FALLBACK_TARGET ||
      cachedFallbackTarget === "n00dles"
    ) {
      cachedFallbackTarget = findBestTarget(
        ns,
        allNetworkServers, // 1. nodes
        p.skills.hacking, // 2. playerHackingLevel (gefehlt!)
        bnMults, // 3. bnMults
        currentState?.batcherTarget ?? null, // 4. blacklistTarget
      );
      lastFallbackUpdate = now;
    }

    // 7. Strategie-Oszillation verhindern (Cooldown)
    const previousStrategy = currentState?.strategy || "MONEY";

    if (mode !== previousStrategy) {
      const isOscillating =
        ["MONEY", "CRIME", "REP", "CORP", "TRAIN"].includes(mode) &&
        ["MONEY", "CRIME", "REP", "CORP", "TRAIN"].includes(previousStrategy);

      if (
        isOscillating &&
        now - modeLockTime < REFRESH_INTERVALS.STRATEGY_COOLDOWN
      ) {
        mode = previousStrategy as BotStrategy;
        if (mode === "REP") targetFaction = currentState?.targetFaction || null;
        if (mode === "CORP") targetCompany = currentState?.targetCompany;
        if (mode === "TRAIN") targetStat = currentState?.targetStat || 0;
      } else {
        modeLockTime = now;
      }
    }

    // 8. Progress Metrics berechnen
    let currentVal = 0;
    let targetVal = 0;
    let label = "";

    if (mode === "REP" && targetFaction) {
      currentVal =
        currentFactionReps[targetFaction] ??
        ns.singularity.getFactionRep(targetFaction);
      targetVal = factionTargets[targetFaction] ?? 0;
      label = `Fraktion: ${targetFaction}`;
    } else if (mode === "CORP" && targetCompany) {
      currentVal = ns.singularity.getCompanyRep(targetCompany);
      targetVal = 400_000;
      label = `Corp: ${targetCompany}`;
    } else if (mode === "TRAIN") {
      currentVal = Math.min(...COMBAT_STATS.map((s) => p.skills[s]));
      targetVal = targetStat ?? 0;
      label = `🏋️ Training (Combat)`;
    } else if (mode === "KILLS") {
      currentVal = p.numPeopleKilled;
      targetVal = targetStat ?? 0;
      label = `💀 Mordaufträge`;
    }

    metricTracker.update(mode, currentVal, targetVal, (oldMode, newMode) => {
      logger.info(
        `🔄 Strategiewechsel: ${oldMode || "START"} ➔ ${newMode} ${label ? `(${label})` : ""}`,
      );
    });

    const etaStr = metricTracker.getEtaString(mode, currentVal, targetVal);

    const finalBar = generateProgressBar(ns, {
      mode,
      label,
      currentVal,
      targetVal,
      etaStr,
      targetFaction,
      playerMoney,
      effectiveThreshold,
      cachedFallbackTarget,
      hasFormulas,
      canRunBatcher: isOrchestratorRunning,
      factionToWorkFor,
      isReadyForFactionGrind,
      crimeMoneyMult,
      currentState,
    });

    let sharePercent = 0.0;
    if (mode === "REP") sharePercent = 0.4;
    if (mode === "MONEY") sharePercent = 0.1;

    let dynamicMaxXp = 1000;
    if (mode === "CRIME") {
      dynamicMaxXp = 100;
    } else if (p.skills.hacking > 800) {
      dynamicMaxXp = 1500;
    }

    // 🚀 1. Orchestrator & Dashboard Steuerung
    if (
      !isOrchestratorRunning &&
      ns.fileExists(sysOrchestratorScript, "home") &&
      getFreeRam() >= ns.getScriptRam(sysOrchestratorScript, "home")
    ) {
      const pid = ns.run(sysOrchestratorScript, 1);
      if (pid > 0) {
        logger.success(`🚀 Orchestrator gestartet (${sysOrchestratorScript})`);
      }
    }

    // if (
    //   ns.isRunning(sysOrchestratorScript, "home") &&
    //   ns.fileExists(sysDashboardScript, "home") &&
    //   !ns.isRunning(sysDashboardScript, "home") &&
    //   getFreeRam() >= ns.getScriptRam(sysDashboardScript, "home")
    // ) {
    //   ns.run(sysDashboardScript, 1);
    // }

    // 💾 2. Zustand im State-Manager speichern
    patchState(ns, {
      strategy: mode,
      targetFaction: targetFaction || undefined,
      targetCompany: targetCompany,
      targetStat: mode === "TRAIN" ? targetStat : undefined,
      targetKills: mode === "KILLS" ? targetStat : undefined,
      progressBar: finalBar,
      fillerConfig: {
        shareMaxRamPercent: sharePercent,
        maxXpLevel: dynamicMaxXp,
      },
    });

    const isEarlyGameCrime =
      homeMaxRam < 128 && (mode === "CRIME" || mode === "KILLS");

    if (isEarlyGameCrime) {
      if (ns.isRunning("tasks/faction-shopping.js", "home"))
        ns.scriptKill("tasks/faction-shopping.js", "home");
      const rogueScripts = ["daemons/hacknet.js", "daemons/hacknet-early.js"];
      for (const script of rogueScripts) {
        if (ns.fileExists(script, "home") && ns.isRunning(script, "home"))
          ns.scriptKill(script, "home");
      }
    } else {
      if (
        getFreeRam() > 12 &&
        ns.fileExists("tasks/faction-shopping.js", "home") &&
        !ns.isRunning("tasks/faction-shopping.js", "home")
      ) {
        ns.run("tasks/faction-shopping.js", 1);
      }
    }

    // ⚙️ 3. Microservices verwalten
    manageMicroservices(
      ns,
      mode,
      hasSavingTarget,
      logger,
      sysOrchestratorScript,
      targetStat,
      isBatcherActive,
    );


    await ns.sleep(2000);
  }
}

function manageMicroservices(
  ns: NS,
  currentMode: string,
  hasSavingTarget: boolean,
  logger: Logger,
  sysOrchestratorScript: string,
  targetStat?: number,
  isBatcherActive?: boolean,
): void {
  const modeToScript: Record<string, string> = {
    REP: "tasks/faction-grind.js",
    CORP: "tasks/corp.js",
    TRAIN: "tasks/train.js",
    CRIME: "tasks/crime.js",
    KILLS: "tasks/crime.js",
  };

  let targetScript = modeToScript[currentMode];

  if (
    currentMode === "MONEY" &&
    (hasSavingTarget || !ns.isRunning(sysOrchestratorScript, "home")) &&
    !isBatcherActive
  ) {
    targetScript = "tasks/crime.js";
  }

  // Nicht mehr benötigte Microservices beenden
  for (const [_, script] of Object.entries(modeToScript)) {
    if (script !== targetScript && ns.isRunning(script, "home")) {
      ns.scriptKill(script, "home");
      logger.info(`⏹️ Veralteten Microservice beendet: ${script}`);
    }
  }

  // Gewünschten Target-Script starten oder neu ausrichten
  if (targetScript && ns.fileExists(targetScript, "home")) {
    const runningProc = ns.ps("home").find((p) => p.filename === targetScript);
    const isRunning = runningProc !== undefined;
    let shouldStart = !isRunning;

    if (isRunning && currentMode === "TRAIN" && targetStat !== undefined) {
      const currentRunningTarget = runningProc?.args[0] as number | undefined;

      if (currentRunningTarget !== targetStat) {
        ns.scriptKill(targetScript, "home");
        shouldStart = true;
        logger.info(
          `🔄 Trainingsziel geändert (${currentRunningTarget} ➔ ${targetStat}). Starte Worker neu.`,
        );
      }
    }

    if (shouldStart) {
      const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
      const requiredRam = ns.getScriptRam(targetScript, "home");

      if (freeRam >= requiredRam) {
        const args: (string | number)[] = [];
        if (currentMode === "TRAIN" && targetStat !== undefined) {
          args.push(targetStat);
        }

        const pid = ns.run(targetScript, 1, ...args);
        if (pid > 0) {
          logger.success(
            `▶️ Microservice gestartet: ${targetScript} für [${currentMode}] mit Args: ${args}`,
          );
        } else {
          logger.error(
            `❌ Fehler beim Starten von ${targetScript} (PID war 0).`,
          );
        }
      } else {
        logger.warn(
          `RAM-MANGEL! ${targetScript} benötigt ${requiredRam.toFixed(2)} GB.`,
        );
      }
    }
  }
}
