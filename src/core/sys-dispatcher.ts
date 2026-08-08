import { NS, FactionName, CompanyName, BitNodeMultipliers } from "@ns";

import { generateProgressBar } from "../ui/ui-helper.js";
import {
  REFRESH_INTERVALS,
  COMBAT_STATS,
  CITY_FACTIONS,
} from "/lib/constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";

import { MetricTracker } from "/lib/metrics.js";
import { getAllServers, findBestTarget } from "/lib/network.js";
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
    perfMonitor: PATHS.daemons.perfMonitor,
    logger: PATHS.core.logger,
    financeDispatcher: PATHS.daemons.financeDispatcher,
    financeCore: PATHS.core.financeCore,
    worker: PATHS.payloads.work,
    hack: PATHS.payloads.hack,
    grow: PATHS.payloads.grow,
    weaken: PATHS.payloads.weaken,
    sysOrchestrator: PATHS.core.sysOrchestrator,
    batchOrchestrator: PATHS.daemons.batchOrchestrator,
    fillShare: PATHS.daemons.fillShare,
    cctSolver: PATHS.tasks.cctSolver,
    dnet: PATHS.managers.dnet,
    crawler: PATHS.daemons.crawler,
    sysDispatcher: PATHS.core.dispatcher,
    backdoor: PATHS.daemons.backdoor,
    augAnalyze: PATHS.tasks.analyzeAug,
    sleeve: PATHS.managers.sleeve,
    gang: PATHS.managers.gang,
    hashManager: PATHS.managers.hash,
  };

  let lastAugAnalysis = 0;

  while (true) {
    const now = Date.now();
    const currentState = loadState(ns);

    // --- 1. Netzwerk & Background-Tasks Logging ---
    if (
      now - lastNetworkScan > REFRESH_INTERVALS.NETWORK_SCAN ||
      allNetworkServers.length === 0
    ) {
      const stateServers = currentState?.allServers;

      if (stateServers && stateServers.length > 0) {
        allNetworkServers = stateServers;
      } else {
        allNetworkServers = getAllServers(ns);
      }

      lastNetworkScan = now;
      logger.debug(
        `Netzwerk-Scan aktualisiert (${allNetworkServers.length} Server).`,
        undefined,
        {
          context: {
            source: stateServers && stateServers.length > 0 ? "state" : "scan",
          },
        },
      );
    }

    const p = ns.getPlayer();
    const gangState = loadGangState(ns);
    const gangFaction = gangState?.hasGang ? gangState.gangFaction : null;

    const isBN2GangMode =
      currentState?.isBN2GangMode ?? isGangOfferingAllAugs(ns);

    const factionTargets = (currentState?.factionTargets ?? {}) as Partial<
      Record<FactionName, number>
    >;

    if (now - lastAugAnalysis > 300_000 || !currentState?.augRoadMap) {
      if (ns.fileExists(scripts.augAnalyze, "home")) {
        logger.info("Starte Augmentation-Analyse (augAnalyze)...", undefined, {
          context: {
            reason: !currentState?.augRoadMap ? "missing_roadmap" : "interval",
          },
        });
        ns.run(scripts.augAnalyze, 1);
        lastAugAnalysis = now;
      }
    }

    const currentCity = CITY_FACTIONS.find((c) => p.factions.includes(c));

    const augRoadmap = currentState?.augRoadMap ?? [];
    const nextRoadmapFaction = findNextRoadmapFaction(
      ns,
      augRoadmap,
      gangFaction,
      currentCity,
    );

    handleFactionInvitations(ns, logger);
    const currentFactionReps: Record<string, number> = {};
    for (const f of p.factions) {
      currentFactionReps[f] = ns.singularity.getFactionRep(f);
    }
    if (nextRoadmapFaction) {
      factionTargets[nextRoadmapFaction.name as FactionName] =
        nextRoadmapFaction.targetRep;
    }

    if (
      p.skills.hacking >= 250 &&
      now - lastCorpApplication > REFRESH_INTERVALS.MEGACORP_APPLY
    ) {
      logger.info("Sende automatische Megacorp-Bewerbungen.", undefined, {
        context: { hackLevel: p.skills.hacking },
      });
      applyToAllMegacorps(ns, p, logger);
      lastCorpApplication = now;
    }

    const hasFormulas = ns.fileExists("Formulas.exe", "home");
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

    // --- 2. Thresholds loggen, bevor die Strategie bestimmt wird ---
    const isReadyForFactionGrind =
      isBatcherActive || playerMoney > effectiveThreshold;
    logger.debug("Ressourcen-Check für Strategiewahl:", undefined, {
      context: {
        money: playerMoney,
        threshold: effectiveThreshold,
        isReady: isReadyForFactionGrind,
        batcherActive: isBatcherActive,
        nextFaction: nextRoadmapFaction?.name || "none",
      },
    });

    // 💡 Korrektur: Daedalus erlaubt, auch wenn isBN2GangMode aktiv ist
    const isDaedalus = nextRoadmapFaction?.name === "Daedalus";
    const factionToWorkFor =
      (!isBN2GangMode || isDaedalus) && factionRepMult > 0.1
        ? nextRoadmapFaction
        : null;
    const hasSavingTarget =
      factionToWorkFor !== null && !isReadyForFactionGrind;

    const isOrchestratorRunning = ns.isRunning(
      scripts.batchOrchestrator,
      "home",
    );

    let strategy = determineStrategy(
      ns,
      p,
      currentState,
      bnMults,
      (ns as any).heart?.break() ?? 0,
      isOrchestratorRunning,
      factionTargets as Record<FactionName, number>,
      nextRoadmapFaction,
      factionToWorkFor,
      isReadyForFactionGrind,
    );

    // 💡 Korrektur: Blockiere REP-Modus im BN2/Gang-Mode NUR dann, wenn es NICHT Daedalus ist
    if (
      isBN2GangMode &&
      strategy.mode === "REP" &&
      strategy.targetFaction !== "Daedalus"
    ) {
      strategy = { mode: "MONEY" };
    }

    let { mode, targetFaction = null, targetCompany, targetStat } = strategy;

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

    // --- 3. Oszillations-Schutz (Flattern) loggen ---
    const previousStrategy = currentState?.strategy || "MONEY";
    if (mode !== previousStrategy) {
      const isOscillating =
        ["MONEY", "CRIME", "REP", "CORP", "TRAIN"].includes(mode) &&
        ["MONEY", "CRIME", "REP", "CORP", "TRAIN"].includes(previousStrategy);

      if (
        isOscillating &&
        now - modeLockTime < REFRESH_INTERVALS.STRATEGY_COOLDOWN
      ) {
        logger.warn(
          `🔄 Oszillations-Schutz! Blockiere Wechsel zu [${mode}]. Bleibe bei [${previousStrategy}].`,
        );
        mode = previousStrategy as BotStrategy;

        if (mode === "REP")
          targetFaction = (currentState?.targetFaction as FactionName) || null;
        if (mode === "CORP")
          targetCompany = currentState?.targetCompany as CompanyName;
        if (mode === "TRAIN") targetStat = currentState?.targetStat || 0;
      } else {
        logger.info(
          `✅ Strategie-Wechsel freigegeben: ${previousStrategy} ➔ ${mode}`,
        );
        modeLockTime = now;
      }
    }

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

    let sharePercent = mode === "REP" ? 0.4 : mode === "MONEY" ? 0.1 : 0.0;
    let dynamicMaxXp =
      mode === "CRIME" ? 100 : p.skills.hacking > 800 ? 1500 : 1000;

    patchState(ns, {
      strategy: mode,
      isBN2GangMode,
      hasGang: gangState?.hasGang ?? false,
      gangFaction: gangFaction ?? undefined,
      targetFaction: targetFaction || undefined,
      isGrindingNFG: nextRoadmapFaction?.isNFG ?? false,
      targetCompany: targetCompany,
      targetStat: mode === "TRAIN" ? targetStat : undefined,
      targetKills: mode === "KILLS" ? targetStat : undefined,
      progressBar: finalBar,
      fillerConfig: {
        shareMaxRamPercent: sharePercent,
        maxXpLevel: dynamicMaxXp,
      },
    });

    //  Übergabe von bnMults an die Microservice-Steuerung
    manageMicroservices(
      ns,
      mode,
      hasSavingTarget,
      logger,
      scripts.batchOrchestrator,
      targetStat,
      isBatcherActive,
      (ns as any).heart?.break() ?? 0,
      gangState?.hasGang ?? false,
      bnMults,
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
  bnMults?: BitNodeMultipliers,
): void {
  const modeToScript: Record<string, string> = {
    REP: PATHS.tasks.faction,
    CORP: PATHS.tasks.corp,
    TRAIN: PATHS.tasks.train,
    UNI: PATHS.tasks.uni,
    CRIME: PATHS.tasks.crime,
    KILLS: PATHS.tasks.crime,
  };

  let targetScript: string | undefined = modeToScript[currentMode];
  let overrideArgs: (string | number)[] | undefined = undefined;

  // --- Loggen, warum im Money-Modus was passiert ---
  if (currentMode === "MONEY") {
    const isGangUnlocked = hasGang || currentKarma <= -54000;
    if (!isGangUnlocked) {
      logger.debug(
        `[MONEY] Keine Gang (Karma: ${Math.round(currentKarma)}). Nutze Crime-Task.`,
      );
      targetScript = PATHS.tasks.crime;
    } else {
      logger.debug(`[MONEY] Gang/Batcher verfügbar. Pausiere manuelle Tasks.`);
      targetScript = undefined;
    }
  }

  // --- Kills mit Begründung loggen ---
  for (const [modeName, script] of Object.entries(modeToScript)) {
    if (script && script !== targetScript && ns.isRunning(script, "home")) {
      ns.scriptKill(script, "home");
      logger.info(`⏹️ Microservice beendet: ${script}`, undefined, {
        context: { reason: "ModeMismatch", currentMode, oldMode: modeName },
      });
    }
  }

  if (targetScript && ns.fileExists(targetScript, "home")) {
    const runningProc = ns.ps("home").find((p) => p.filename === targetScript);
    const isRunning = runningProc !== undefined;
    let shouldStart = !isRunning;

    const effectiveArgs: (string | number)[] =
      overrideArgs ??
      (currentMode === "TRAIN" && targetStat !== undefined ? [targetStat] : []);

    // --- Neustart mit Argumenten loggen ---
    if (isRunning && effectiveArgs.length > 0) {
      const currentRunningTarget = runningProc?.args[0];
      const expectedTarget = effectiveArgs[0];

      if (currentRunningTarget !== expectedTarget) {
        logger.info(
          `🔄 Neustart erforderlich: Parameter geändert (${currentRunningTarget} ➔ ${expectedTarget}).`,
        );
        ns.scriptKill(targetScript, "home");
        shouldStart = true;
      }
    }

    // --- RAM-Probleme präziser loggen ---
    if (shouldStart) {
      const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
      const requiredRam = ns.getScriptRam(targetScript, "home");

      if (freeRam >= requiredRam) {
        const pid = ns.run(targetScript, 1, ...effectiveArgs);
        if (pid > 0) {
          logger.success(
            `▶️ Microservice gestartet: ${targetScript}`,
            undefined,
            {
              context: { mode: currentMode, args: effectiveArgs.join(",") },
            },
          );
        } else {
          logger.error(`❌ Fehler beim Starten von ${targetScript} (PID 0).`);
        }
      } else {
        logger.warn(`RAM-MANGEL! ${targetScript} pausiert.`, undefined, {
          context: { required: requiredRam, free: freeRam },
        });
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
    if (isCity && currentCity && currentCity !== invite) continue;

    if (sing.joinFaction(invite)) {
      logger.success(
        `🎉 Einladung zu Fraktion [${invite}] automatisch angenommen!`,
      );
      ns.toast(`Beigetreten: ${invite}`, "success");
    }
  }
}
