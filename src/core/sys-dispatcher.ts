import { NS, FactionName, CompanyName } from "@ns";

import { generateProgressBar } from "../ui/ui-helper.js";
import {
  DEFAULT_MULTIPLIERS,
  REFRESH_INTERVALS,
  COMBAT_STATS,
  CITY_FACTIONS,
} from "/lib/constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";

import { MetricTracker } from "/lib/metrics.js";
import {
  getAllServers,
  findBestTarget,
} from "/lib/network.js";
import {
  findNextRoadmapFaction,
  applyToAllMegacorps,
  determineStrategy,
  isGangOfferingAllAugs,
} from "/lib/player.js";
import { loadGangState, loadState, patchState } from "/lib/state.js";
import { loadBnMults } from "/lib/utils.js";
import { PATHS } from "/lib/paths.js";
import { ScriptList } from "/lib/types/common.js";
import { BotStrategy } from "/lib/types/strategy.js";

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
  const bnMults = loadBnMults(ns);

  const metricTracker = new MetricTracker();

  let cachedFallbackTarget = "n00dles";
  let lastFallbackUpdate = 0;
  let modeLockTime = 0;
  let lastCorpApplication = 0;

  let allNetworkServers: string[] = [];
  let lastNetworkScan = 0;

  const scripts: ScriptList = {
    financeCore: PATHS.core.financeCore,
    logger: PATHS.core.logger,
    perfMonitor: PATHS.daemons.perfMonitor,
    worker: PATHS.payloads.work,
    dispatcher: PATHS.core.dispatcher,
    backdoor: PATHS.daemons.backdoor,
    dnet: PATHS.managers.dnet,
    crawler: PATHS.daemons.crawler,
    hack: PATHS.payloads.hack,
    grow: PATHS.payloads.grow,
    weaken: PATHS.payloads.weaken,
    sleeve: PATHS.managers.sleeve,
    fillShare: PATHS.daemons.fillShare,
    augAnalyze: PATHS.tasks.analyzeAug,
    orchestrator: PATHS.core.orchestrator,
    suites: PATHS.core.suites,
    gang: PATHS.managers.gang,
  };

  let lastAugAnalysis = 0;

  while (true) {
    const now = Date.now();
    const currentState = loadState(ns);

    // 1. Aktualisierung der Serverliste aus dem Kernel-State (oder Fallback-Scan)
    if (
      now - lastNetworkScan > REFRESH_INTERVALS.NETWORK_SCAN ||
      allNetworkServers.length === 0
    ) {
      allNetworkServers =
        currentState?.allServers && currentState.allServers.length > 0
          ? currentState.allServers
          : getAllServers(ns);
      lastNetworkScan = now;
    }

    const p = ns.getPlayer();
    const gangState = loadGangState(ns);
    const gangFaction = gangState?.hasGang ? gangState.gangFaction : null;

    // ⚡ BN2-Gang Check: Bietet die Gang ALLE Augmentationen an?
    const isBN2GangMode =
      currentState?.isBN2GangMode ?? isGangOfferingAllAugs(ns);

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

    const currentCity = CITY_FACTIONS.find((c) => p.factions.includes(c));

    // Fraktions-Ziel über Roadmap ermitteln
    const augRoadmap = currentState?.augRoadMap ?? [];
    const nextRoadmapFaction = isBN2GangMode
      ? null
      : findNextRoadmapFaction(ns, augRoadmap, gangFaction, currentCity);

    // 2. Fraktions-Einladungen verarbeiten & Reps erfassen
    handleFactionInvitations(ns, logger);
    const currentFactionReps: Record<string, number> = {};
    for (const f of p.factions) {
      currentFactionReps[f] = ns.singularity.getFactionRep(f);
    }
    if (nextRoadmapFaction) {
      factionTargets[nextRoadmapFaction.name as FactionName] =
        nextRoadmapFaction.targetRep;
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

    const factionToWorkFor =
      !isBN2GangMode && factionRepMult > 0.1 ? nextRoadmapFaction : null;
    const hasSavingTarget =
      factionToWorkFor !== null && !isReadyForFactionGrind;

    const isOrchestratorRunning = ns.isRunning(scripts.orchestrator, "home");

    // 5. Strategie ermitteln
    let strategy = determineStrategy(
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

    if (isBN2GangMode && strategy.mode === "REP") {
      strategy = { mode: "MONEY" };
    }

    let { mode, targetFaction = null, targetCompany, targetStat } = strategy;

    // 6. Fallback-Target ermitteln
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
        if (mode === "REP")
          targetFaction = (currentState?.targetFaction as FactionName) || null;
        if (mode === "CORP")
          targetCompany = currentState?.targetCompany as CompanyName;
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
      const factionKey = targetFaction as FactionName;
      currentVal =
        currentFactionReps[factionKey] ??
        ns.singularity.getFactionRep(factionKey);
      targetVal = factionTargets[factionKey] ?? 0;
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
      targetFaction: targetFaction ?? null,
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

    // NFG-Status aus der Roadmap ermitteln
    const isGrindingNFG = nextRoadmapFaction?.isNFG ?? false;

    // Zustand im State-Manager speichern
    patchState(ns, {
      strategy: mode,
      isBN2GangMode,
      hasGang: gangState?.hasGang ?? false,
      gangFaction: gangFaction ?? undefined,

      targetFaction: targetFaction || undefined,
      isGrindingNFG: isGrindingNFG,
      targetCompany: targetCompany,
      targetStat: mode === "TRAIN" ? targetStat : undefined,
      targetKills: mode === "KILLS" ? targetStat : undefined,
      progressBar: finalBar,
      fillerConfig: {
        shareMaxRamPercent: sharePercent,
        maxXpLevel: dynamicMaxXp,
      },
    });

    // Microservices verwalten
    manageMicroservices(
      ns,
      mode,
      hasSavingTarget,
      logger,
      scripts.orchestrator,
      targetStat,
      isBatcherActive,
      currentKarma,
      gangState?.hasGang ?? false,
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
  currentKarma: number = 0,
  hasGang: boolean = false,
): void {
  const modeToScript: Record<string, string> = {
    REP: PATHS.tasks.faction,
    CORP: PATHS.tasks.corp,
    TRAIN: PATHS.tasks.train,
    UNI: PATHS.tasks.uni,
    CRIME: PATHS.tasks.crime,
    KILLS: PATHS.tasks.crime,
  };

  let targetScript = modeToScript[currentMode];
  let overrideArgs: (string | number)[] | undefined = undefined;

  if (currentMode === "MONEY") {
    const isGangUnlocked = hasGang || currentKarma <= -5400;

    if (!isGangUnlocked) {
      targetScript = PATHS.tasks.crime;
    } else {
      targetScript = PATHS.tasks.uni;
      if (targetStat !== undefined) {
        overrideArgs = [targetStat];
      }
    }
  }

  for (const [_, script] of Object.entries(modeToScript)) {
    if (script && script !== targetScript && ns.isRunning(script, "home")) {
      ns.scriptKill(script, "home");
      logger.info(`⏹️ Veralteten Microservice beendet: ${script}`);
    }
  }

  if (targetScript && ns.fileExists(targetScript, "home")) {
    const runningProc = ns.ps("home").find((p) => p.filename === targetScript);
    const isRunning = runningProc !== undefined;
    let shouldStart = !isRunning;

    const effectiveArgs: (string | number)[] =
      overrideArgs ??
      (currentMode === "TRAIN" && targetStat !== undefined ? [targetStat] : []);

    if (isRunning && effectiveArgs.length > 0) {
      const currentRunningTarget = runningProc?.args[0];
      const expectedTarget = effectiveArgs[0];

      if (currentRunningTarget !== expectedTarget) {
        ns.scriptKill(targetScript, "home");
        shouldStart = true;
        logger.info(
          `🔄 Ziel-Parameter geändert (${currentRunningTarget} ➔ ${expectedTarget}). Starte Worker neu.`,
        );
      }
    }

    if (shouldStart) {
      const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
      const requiredRam = ns.getScriptRam(targetScript, "home");

      if (freeRam >= requiredRam) {
        const pid = ns.run(targetScript, 1, ...effectiveArgs);
        if (pid > 0) {
          logger.success(
            `▶️ Microservice gestartet: ${targetScript} für [${currentMode}] mit Args: ${effectiveArgs.join(", ")}`,
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

function handleFactionInvitations(ns: NS, logger: Logger): void {
  const sing = ns.singularity;
  const player = ns.getPlayer();
  const invites = sing.checkFactionInvitations();
  if (invites.length === 0) return;

  const currentCity = CITY_FACTIONS.find((c) => player.factions.includes(c));

  for (const invite of invites) {
    const isCity = CITY_FACTIONS.includes(invite as FactionName);

    if (isCity && currentCity && currentCity !== invite) {
      continue;
    }

    if (sing.joinFaction(invite)) {
      logger.success(
        `🎉 Einladung zu Fraktion [${invite}] automatisch angenommen!`,
      );
      ns.toast(`Beigetreten: ${invite}`, "success");
    }
  }
}