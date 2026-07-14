import { NS, Player, FactionName, CompanyName } from "@ns";
import { loadState, patchState, BotStrategy } from "./state-manager.js";
import { breakAndInfectNetwork, getAllServers, findBestFallbackTarget, dispatchSimpleTask } from "../lib/network.js";
import { findNextRoadmapFaction, applyToAllMegacorps } from "/lib/player.js";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js";
import { Logger } from "./logger.js";
import { 
  FactionConfig, 
  REFRESH_INTERVALS, 
  BATCHER_MIN_RAM, 
  COMBAT_STATS, 
  MEGACORPS, 
  HACKING_FACTIONS, 
  CITY_FACTIONS 
} from "../lib/constants.js";

// --- NEUE EXTERNE MODULE ---
import { determineStrategy } from "../lib/strategy.js";
import { MetricTracker } from "../lib/metrics.js";
import { generateProgressBar } from "../lib/ui-helper.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Dispatcher", "INFO");

  if (ns.singularity === undefined) {
    logger.error("Kritischer Systemfehler: Singularity-API (SF4) fehlt!");
    ns.tprint("🛑 [Dispatcher] Kritischer Fehler: Singularity-API (SF4) fehlt!");
    return;
  }

  logger.info("Initialisiere Netzwerk-Multiplikatoren...");
  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;

  // Neuer, gekapselter Metric-Tracker (ersetzt lastValue, lastTime, emaRate, lastMode)
  const metricTracker = new MetricTracker();

  let cachedFallbackTarget = "n00dles";
  let lastFallbackUpdate = 0;
  let modeLockTime = 0;
  let lastCorpApplication = 0;

  let allNetworkServers: string[] = [];
  let lastNetworkScan = 0;

  // --- Absolute Pfade für Hilfsskripte ---
  const analyzeFactionsScript = "/tasks/analyze-factions.js";
  const sysBatcherScript = "/core/sys-batcher.js";
  const fillRamScript = "/utils/fill-ram.js";
  const factionShoppingScript = "/tasks/faction-shopping.js";

  while (true) {
    const now = Date.now();

    // --- THROTTLED NETZWERK SCAN ---
    if (
      now - lastNetworkScan > REFRESH_INTERVALS.NETWORK_SCAN ||
      allNetworkServers.length === 0
    ) {
      breakAndInfectNetwork(ns);
      allNetworkServers = getAllServers(ns);
      lastNetworkScan = now;
    }

    // --- STATE LADEN & DYNAMISCH EVALUIEREN ---
    const currentState = loadState(ns);
    const factionTargets = (currentState?.factionTargets ?? {}) as Record<
      FactionName,
      number
    >;

    // Absolute Pfad-Prüfung für die Faction-Analyse
    if (
      Object.keys(factionTargets).length === 0 &&
      !ns.isRunning(analyzeFactionsScript, "home")
    ) {
      const analyzeRam = ns.getScriptRam(analyzeFactionsScript, "home");
      const freeHomeRam =
        ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
      if (freeHomeRam >= analyzeRam) {
        ns.run(analyzeFactionsScript, 1);
        logger.info(
          "Factions-Analyse fehlt im State. 'analyze-factions.js' proaktiv gestartet.",
        );
      }
    }

    const p = ns.getPlayer();
    const homeMaxRam = ns.getServerMaxRam("home");
    const getFreeRam = () => homeMaxRam - ns.getServerUsedRam("home");
    const currentKarma = (ns as any).heart?.break() ?? 0;

    if (
      p.skills.hacking >= 250 &&
      now - lastCorpApplication > REFRESH_INTERVALS.MEGACORP_APPLY
    ) {
      applyToAllMegacorps(ns, p, logger);
      lastCorpApplication = now;
    }

    // --- INFRASTRUKTUR VORABBERECHNUNG ---
    const pServers = ns.cloud.getServerNames();
    const hasFormulas = ns.fileExists("Formulas.exe", "home");

    const maxNetworkRam = allNetworkServers.reduce((max, s) => {
      if (!ns.hasRootAccess(s) || pServers.includes(s) || s === "home")
        return max;
      const ram = ns.getServerMaxRam(s);
      return ram > max ? ram : max;
    }, 0);

    const canRunBatcher =
      hasFormulas && (homeMaxRam >= BATCHER_MIN_RAM || maxNetworkRam >= 32);

    // --- STRATEGIE-MATRIX VARIABLEN ---
    const playerMoney = p.money;
    const factionRepMult = bnMults.FactionWorkRepGain ?? 1;
    const companyRepMult = bnMults.CompanyWorkRepGain ?? 1;
    const crimeMoneyMult = bnMults.CrimeMoney ?? 1;

    const BASE_MONEY_THRESHOLD = factionRepMult < 0.5 ? 50_000_000 : 10_000_000;
    const lastStrategy = currentState?.strategy || "MONEY";
    const effectiveThreshold =
      lastStrategy === "REP"
        ? BASE_MONEY_THRESHOLD * 0.7
        : BASE_MONEY_THRESHOLD;

    const isReadyForFactionGrind = playerMoney > effectiveThreshold;

    const currentFactionReps: Record<string, number> = {};
    for (const f of p.factions) {
      currentFactionReps[f] = ns.singularity.getFactionRep(f);
    }

    const nextRoadmapFaction = findNextRoadmapFaction(
      p,
      currentFactionReps,
      factionTargets,
    );
    const roadmapFactionName = nextRoadmapFaction ? nextRoadmapFaction.name : null;
    const factionToWorkFor = factionRepMult > 0.1 ? nextRoadmapFaction : null;
    const hasSavingTarget = factionToWorkFor !== null && !isReadyForFactionGrind;

    const maxPservers = ns.cloud.getServerLimit();
    const lacksPservers =
      pServers.length < maxPservers ||
      pServers.some((s) => ns.getServerMaxRam(s) < 64);
    const isRushActive = hasFormulas && homeMaxRam >= 256 && lacksPservers;

    // --- STRATEGIE ENTSCHEIDUNG (MODUL!) ---
    const strategy = determineStrategy(
      ns,
      p,
      currentState,
      bnMults,
      currentKarma,
      isRushActive,
      canRunBatcher,
      factionTargets,
      nextRoadmapFaction,
      factionToWorkFor,
      isReadyForFactionGrind
    );

    let { mode, targetFaction, targetCompany, targetStat } = strategy;

    // --- FALLBACK TARGET UPDATE ---
    if (
      now - lastFallbackUpdate > REFRESH_INTERVALS.FALLBACK_TARGET ||
      cachedFallbackTarget === "n00dles"
    ) {
      cachedFallbackTarget = findBestFallbackTarget(
        ns,
        p.skills.hacking,
        bnMults,
        allNetworkServers,
        canRunBatcher ? currentState?.batcherTarget : null,
      );
      lastFallbackUpdate = now;
    }

    // --- COOLDOWN ENGINE (SCHONFRIST) ---
    const previousStrategy = currentState?.strategy || "MONEY";

    if (mode !== previousStrategy) {
      const isOscillating =
        ["MONEY", "CRIME", "REP", "CORP", "TRAIN", "PSERV_RUSH"].includes(mode) &&
        ["MONEY", "CRIME", "REP", "CORP", "TRAIN", "PSERV_RUSH"].includes(previousStrategy);

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

    // --- METRIK-ERFASSUNG (MODUL!) ---
    let currentVal = 0;
    let targetVal = 0;
    let label = "";

    if (mode === "REP" && targetFaction) {
      currentVal = currentFactionReps[targetFaction] ?? ns.singularity.getFactionRep(targetFaction);
      targetVal = factionTargets[targetFaction] ?? 0;
      label = `Fraktion: ${targetFaction}`;
    } else if (mode === "CORP" && targetCompany) {
      currentVal = ns.singularity.getCompanyRep(targetCompany);
      targetVal = 400_000;
      label = `Corp: ${targetCompany}`;
    } else if (mode === "TRAIN") {
      currentVal = Math.min(...COMBAT_STATS.map((s) => p.skills[s]));
      targetVal = targetStat;
      label = `🏋️ Training (Combat)`;
    } else if (mode === "KILLS") {
      currentVal = p.numPeopleKilled;
      targetVal = targetStat;
      label = `💀 Mordaufträge`;
    }

    // Update den Tracker und logge Strategiewechsel via Callback
    metricTracker.update(mode, currentVal, targetVal, (oldMode, newMode) => {
      logger.info(
        `🔄 Strategiewechsel: ${oldMode || "START"} ➔ ${newMode} ${label ? `(${label})` : ""}`,
      );
    });

    const etaStr = metricTracker.getEtaString(mode, currentVal, targetVal);

    // --- UI DASHBOARD UPDATE (MODUL!) ---
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
      canRunBatcher,
      factionToWorkFor,
      isReadyForFactionGrind,
      crimeMoneyMult,
      currentState,
    });

    // --- NETZWERK- & WORKER-EINSTELLUNGEN ---
    let sharePercent = 0.0;
    if (mode === "REP") sharePercent = 0.4;
    if (mode === "MONEY") sharePercent = 0.1;

    let dynamicMaxXp = 1000;
    if (mode === "CRIME") {
      dynamicMaxXp = 100;
    } else if (p.skills.hacking > 800) {
      dynamicMaxXp = 1500;
    }

    if (!canRunBatcher && ns.isRunning("/utils/fill-ram.js", "home")) {
      ns.scriptKill("/utils/fill-ram.js", "home");
      logger.info("Batcher nicht ausführbar. 'fill-ram.js' beendet.");
    }

    // State updaten
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
      homeMaxRam < 128 &&
      (mode === "CRIME" || mode === "XP_SPRINT" || mode === "KILLS");

    if (isEarlyGameCrime) {
      if (ns.isRunning("/tasks/faction-shopping.js", "home"))
        ns.scriptKill("/tasks/faction-shopping.js", "home");
      const rogueScripts = ["/systems/hacknet.js", "/systems/hacknet-early.js"];
      for (const script of rogueScripts) {
        if (ns.fileExists(script, "home") && ns.isRunning(script, "home"))
          ns.scriptKill(script, "home");
      }
    } else {
      if (
        getFreeRam() > 12 &&
        !ns.isRunning("/tasks/faction-shopping.js", "home")
      ) {
        ns.run("/tasks/faction-shopping.js", 1);
      }
    }

    // --- WORKER ALLOKATION ---
    const workerScript = mode === "XP_SPRINT" ? "/tasks/xp-grind.js" : "/tasks/work.js";
    const obsoleteScript = mode === "XP_SPRINT" ? "/tasks/work.js" : "/tasks/xp-grind.js";

    const infectedServers = allNetworkServers.filter(
      (s) =>
        s !== "home" &&
        !pServers.includes(s) &&
        ns.hasRootAccess(s) &&
        ns.getServerMaxRam(s) > 0,
    );

    let workerFleet: string[] = [];

    if (canRunBatcher) {
      if (!ns.isRunning(sysBatcherScript, "home") && getFreeRam() > 15) {
        ns.run(sysBatcherScript, 1);
        logger.success(
          "🔥 System-Voraussetzungen erfüllt: 'sys-batcher.js' gestartet.",
        );
      }

      const allAvailableHosts = [...infectedServers, ...pServers];
      for (const server of allAvailableHosts) {
        if (ns.isRunning(workerScript, server))
          ns.scriptKill(workerScript, server);
        if (ns.isRunning(obsoleteScript, server))
          ns.scriptKill(obsoleteScript, server);
      }
    } else {
      workerFleet = [...infectedServers, ...pServers];

      for (const server of workerFleet) {
        if (ns.isRunning(obsoleteScript, server)) {
          ns.scriptKill(obsoleteScript, server);
        }

        if (ns.isRunning(workerScript, server)) {
          const runningProc = ns
            .ps(server)
            .find((proc) => proc.filename === workerScript);
          if (runningProc && runningProc.args[0] !== cachedFallbackTarget) {
            ns.scriptKill(workerScript, server);
          }
        }
      }

      dispatchSimpleTask(
        ns,
        workerFleet,
        workerScript,
        cachedFallbackTarget,
        Infinity,
        bnMults,
      );
    }

    const homeShouldRunWorker =
      !["REP", "TRAIN", "CORP", "CRIME"].includes(mode) && !canRunBatcher;
    if (!homeShouldRunWorker) {
      if (ns.isRunning(workerScript, "home")) {
        ns.scriptKill(workerScript, "home");
      }
    } else {
      let isWorkerRunningWithCorrectTarget = false;
      if (ns.isRunning(workerScript, "home")) {
        const homeProc = ns
          .ps("home")
          .find((proc) => proc.filename === workerScript);
        if (homeProc && homeProc.args[0] !== cachedFallbackTarget) {
          ns.scriptKill(workerScript, "home");
        } else {
          isWorkerRunningWithCorrectTarget = true;
        }
      }

      const homeFreeRam = getFreeRam();
      const reservedRam =
        bnMults.ServerWeakenRate < 1.0
          ? Math.ceil(20 / bnMults.ServerWeakenRate)
          : 20;
      const workerRam = ns.getScriptRam(workerScript);

      if (
        homeFreeRam > reservedRam + workerRam &&
        !isWorkerRunningWithCorrectTarget
      ) {
        const homeThreads = Math.floor((homeFreeRam - reservedRam) / workerRam);
        if (homeThreads > 0) {
          ns.run(workerScript, homeThreads, cachedFallbackTarget);
        }
      }
    }

    const isRamReady =
      homeMaxRam >= 256 ||
      (pServers.length > 0 &&
        Math.max(...pServers.map((s) => ns.getServerMaxRam(s))) >= 64);
    const executionAllowed =
      !hasFormulas || ns.isRunning(sysBatcherScript, "home");

    if (
      isRamReady &&
      !isEarlyGameCrime &&
      executionAllowed &&
      !ns.isRunning(fillRamScript, "home") &&
      getFreeRam() > 15
    ) {
      ns.run(fillRamScript, 1);
    }

    manageMicroservices(ns, mode, hasSavingTarget, logger, targetStat);

    if (mode === "MONEY" && !hasSavingTarget && canRunBatcher) {
      if (ns.singularity.getCurrentWork()) {
        logger.info(
          "Batcher läuft ohne offene Sparziele. Manuelle Arbeit gestoppt.",
        );
        ns.singularity.stopAction();
      }
    }

    await ns.sleep(2000);
  }
}

function manageMicroservices(
  ns: NS,
  currentMode: string,
  hasSavingTarget: boolean,
  logger: Logger,
  targetStat?: number,
): void {
  const modeToScript: Record<string, string> = {
    REP: "/tasks/faction-grind.js",
    CORP: "/tasks/corp.js",
    TRAIN: "/tasks/train.js",
    CRIME: "/tasks/crime.js",
    XP_SPRINT: "/tasks/crime.js",
    KILLS: "/tasks/crime.js",
    PSERV_RUSH: "/tasks/crime.js",
  };

  let targetScript = modeToScript[currentMode];

  if (
    currentMode === "MONEY" &&
    (hasSavingTarget || !ns.isRunning("/core/sys-batcher.js", "home"))
  ) {
    targetScript = "/tasks/crime.js";
  }

  for (const [_, script] of Object.entries(modeToScript)) {
    if (script !== targetScript && ns.isRunning(script, "home")) {
      ns.scriptKill(script, "home");
      logger.info(`⏹️ Veralteten Microservice beendet: ${script}`);
    }
  }

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