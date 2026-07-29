import { NS, FactionName, CompanyName, ProgramName } from "@ns";

import { generateProgressBar } from "../ui/ui-helper.js";
import {
  DEFAULT_MULTIPLIERS,
  REFRESH_INTERVALS,
  COMBAT_STATS,
} from "/lib/constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";

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
import {
  loadBnMults,
  loadGangState,
  loadState,
  patchState,
} from "/lib/state.js";
import { ScriptList, BotStrategy } from "/lib/types.js";
import { PATHS } from "/lib/paths.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Dispatcher");

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
    logger: PATHS.core.logger,
    perfMonitor: PATHS.daemons.perfMonitor,
    worker: PATHS.payloads.work,
    dispatcher: PATHS.core.dispatcher,
    infra: PATHS.managers.infra,
    backdoor: PATHS.daemons.backdoor,
    trade: PATHS.managers.finance,
    hacknet: PATHS.daemons.hacknetEarly,
    dnet: PATHS.managers.dnet,
    crawler: PATHS.daemons.crawler,
    hack: PATHS.payloads.hack,
    grow: PATHS.payloads.grow,
    weaken: PATHS.payloads.weaken,
    sleeve: PATHS.managers.sleeve,
    fillShare: PATHS.daemons.fillShare,
    augShopping: PATHS.tasks.augShopping,
    augAnalyze: PATHS.tasks.analyzeAug,
    orchestrator: PATHS.core.orchestrator,
    suites: PATHS.core.suites,
    gang: PATHS.managers.gang,
  };

  let lastAugAnalysis = 0;

  while (true) {
    const now = Date.now();

    // 1. Periodischer Netzwerk-Scan & Infektion
    if (
      now - lastNetworkScan > REFRESH_INTERVALS.NETWORK_SCAN ||
      allNetworkServers.length === 0
    ) {
      await breakAndInfectNetwork(ns);
      allNetworkServers = getAllServers(ns);
      lastNetworkScan = now;
    }

    const currentState = loadState(ns);
    const gangState = loadGangState(ns);
    const gangFaction = gangState?.hasGang ? gangState.gangFaction : null;

    const factionTargets = (currentState?.factionTargets ?? {}) as Partial<
      Record<FactionName, number>
    >;

    // Periodische Augment-Analyse (alle 5 Minuten oder bei Neustart)
    if (now - lastAugAnalysis > 300_000 || !currentState?.augRoadMap) {
      if (ns.fileExists(scripts.augAnalyze, "home")) {
        ns.run(scripts.augAnalyze, 1);
        lastAugAnalysis = now;
      }
    }

    // Fraktions-Ziel über Roadmap ermitteln (Gang-Fraktion wird ignoriert)
    const augRoadmap = currentState?.augRoadMap ?? [];
    const nextRoadmapFaction = findNextRoadmapFaction(
      ns,
      augRoadmap,
      gangFaction,
    );

    const p = ns.getPlayer();

    // 2. Home-Server / Singularity Upgrades & Kaffe
    handleSingularityPurchases(ns, logger);

    // 3. Fraktions-Reputationen & Roadmap evaluieren
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

    // 4. Megacorp-Bewerbungen prüfen
    if (
      p.skills.hacking >= 250 &&
      now - lastCorpApplication > REFRESH_INTERVALS.MEGACORP_APPLY
    ) {
      applyToAllMegacorps(ns, p, logger);
      lastCorpApplication = now;
    }

    const hasFormulas = ns.fileExists("Formulas.exe", "home");

    // 5. Finanz- & Strategie-Schwellenwerte berechnen
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

    const isOrchestratorRunning = ns.isRunning(scripts.orchestrator, "home");

    // 6. Strategie ermitteln
    const strategy = determineStrategy(
      ns,
      p,
      currentState,
      bnMults,
      currentKarma,
      isOrchestratorRunning,
      factionTargets as Record<FactionName, number>,
      nextRoadmapFaction,
      factionToWorkFor,
      isReadyForFactionGrind,
    );

    let { mode, targetFaction, targetCompany, targetStat } = strategy;

    // 7. Fallback-Target ermitteln
    if (
      now - lastFallbackUpdate > REFRESH_INTERVALS.FALLBACK_TARGET ||
      cachedFallbackTarget === "n00dles"
    ) {
      cachedFallbackTarget = findBestTarget(
        ns,
        allNetworkServers,
        p.skills.hacking,
        bnMults,
        currentState?.batcherTarget ?? null,
      );
      lastFallbackUpdate = now;
    }

    // 8. Strategie-Oszillation verhindern (Cooldown)
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
        if (mode === "REP")
          targetFaction = (currentState?.targetFaction as FactionName) || null;
        if (mode === "CORP")
          targetCompany = currentState?.targetCompany as CompanyName;
        if (mode === "TRAIN") targetStat = currentState?.targetStat || 0;
      } else {
        modeLockTime = now;
      }
    }

    // 9. Progress Metrics berechnen
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

    // 💾 Zustand im State-Manager speichern
    patchState(ns, {
      strategy: mode,
      hasGang: gangState?.hasGang ?? false,
      gangFaction: gangFaction ?? undefined,

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
      if (
        PATHS.tasks.augShopping &&
        ns.isRunning(PATHS.tasks.augShopping, "home")
      ) {
        ns.scriptKill(PATHS.tasks.augShopping, "home");
      }
      const rogueScripts = [
        PATHS.daemons.hacknet,
        PATHS.daemons.hacknetEarly,
      ].filter(Boolean) as string[];

      for (const script of rogueScripts) {
        if (ns.fileExists(script, "home") && ns.isRunning(script, "home")) {
          ns.scriptKill(script, "home");
        }
      }
    } else {
      if (
        getFreeRam() > 12 &&
        PATHS.tasks.augShopping &&
        ns.fileExists(PATHS.tasks.augShopping, "home") &&
        !ns.isRunning(PATHS.tasks.augShopping, "home")
      ) {
        ns.run(PATHS.tasks.augShopping, 1);
      }
    }

    // ⚙️ Microservices verwalten
    manageMicroservices(
      ns,
      mode,
      hasSavingTarget,
      logger,
      scripts.orchestrator,
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
    REP: PATHS.tasks.faction,
    CORP: PATHS.tasks.corp,
    TRAIN: PATHS.tasks.train,
    CRIME: PATHS.tasks.crime,
    KILLS: PATHS.tasks.crime,
  };

  let targetScript = modeToScript[currentMode];

  if (
    currentMode === "MONEY" &&
    (hasSavingTarget || !ns.isRunning(sysOrchestratorScript, "home")) &&
    !isBatcherActive
  ) {
    targetScript = PATHS.tasks.crime;
  }

  // Nicht mehr benötigte Microservices beenden
  for (const [_, script] of Object.entries(modeToScript)) {
    if (script && script !== targetScript && ns.isRunning(script, "home")) {
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

function handleSingularityPurchases(ns: NS, logger: Logger): void {
  const sing = ns.singularity;
  const player = ns.getPlayer();
  const currentHacking = player.skills.hacking;

  // 1. TOR Router kaufen
  if (!ns.hasTorRouter() && player.money >= 200_000 && currentHacking >= 40) {
    if (sing.purchaseTor()) logger.success("📡 TOR-Router erworben.");
  }

  // 2. Programme kaufen
  if (ns.hasTorRouter()) {
    const programGates: Record<string, number> = {
      "BruteSSH.exe": 50,
      "FTPCrack.exe": 150,
      "relaySMTP.exe": 250,
      "HTTPWorm.exe": 350,
      "SQLInject.exe": 500,
      "Formulas.exe": 0,
    };

    for (const [prog, reqLevel] of Object.entries(programGates)) {
      if (!ns.fileExists(prog, "home") && currentHacking >= reqLevel) {
        const cost = sing.getDarkwebProgramCost(prog as ProgramName);
        if (cost > 0 && player.money >= cost) {
          if (sing.purchaseProgram(prog as any)) {
            logger.success(`💾 Software lizenziert: ${prog}`);
          }
        }
      }
    }
  }

  // 3. Home RAM & Core Upgrades durchführen
  const ramCost = sing.getUpgradeHomeRamCost();
  if (ramCost !== Infinity && player.money - 200_000 >= ramCost) {
    if (sing.upgradeHomeRam()) {
      const newRam = ns.getServerMaxRam("home");
      ns.toast(`Home RAM erweitert auf ${ns.format.ram(newRam)}!`, "success");
      logger.success(
        `🏠 Home-RAM Upgrade durchgeführt: ${ns.format.ram(newRam)}`,
      );
    }
  }
}