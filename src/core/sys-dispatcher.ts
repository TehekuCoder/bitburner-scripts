import { NS, Player, FactionName, CompanyName } from "@ns";
import { loadState, patchState } from "./state-manager.js";
import { BotStrategy } from "./types.js";
import {
  breakAndInfectNetwork,
  getAllServers,
  findBestFallbackTarget,
} from "../lib/network.js";
import { findNextRoadmapFaction, applyToAllMegacorps } from "/lib/player.js";
import { loadBnMults } from "../lib/state.js";
import { Logger } from "./logger.js";
import {
  REFRESH_INTERVALS,
  BATCHER_MIN_RAM,
  COMBAT_STATS,
  DEFAULT_MULTIPLIERS,
} from "../lib/constants.js";

// --- EXTERNE MODULE & UTILITIES ---
import { determineStrategy } from "../lib/strategy.js";
import { MetricTracker } from "../lib/metrics.js";
import { generateProgressBar } from "../lib/ui-helper.js";
import { deployWorker } from "../utils/deployment.js"; // 🟢 NEU: Zentrales Deployment importiert
import { ScriptList } from "./types.js"; // 🟢 NEU: Type-Safety Import

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

  logger.info("Initialisiere Netzwerk-Multiplikatoren...");
  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;

  const metricTracker = new MetricTracker();

  let cachedFallbackTarget = "n00dles";
  let lastFallbackUpdate = 0;
  let modeLockTime = 0;
  let lastCorpApplication = 0;

  let allNetworkServers: string[] = [];
  let lastNetworkScan = 0;

  // 🟢 Skript-Pfade zentral als typisierte ScriptList definieren (analog zu early-fleet)
  const scriptsList: ScriptList = {
    worker: "tasks/work.js",
    dispatcher: "core/sys-dispatcher.js",
    infra: "core/sys-infra.js",
    backdoor: "tasks/backdoor.js",
    xpfarm: "tasks/xp-grind.js",
    trade: "systems/finance.js",
    hacknet: "systems/hacknet-early.js",
    dnet: "core/dnet-master.js",
    crawler: "tasks/dnet-crawler.js",
    hack: "tasks/hack.js",
    grow: "tasks/grow.js",
    weaken: "tasks/weaken.js",
    sleeve: "core/sys-sleeve.js",
    dashboard: "core/sys-dashboard.js",
  };

  const sysBatcherScript = "core/sys-jit-batcher.js";
  const sysDashboardScript = "core/sys-jit-batcher-dashboard.js";
  const fillRamScript = "utils/fill-ram.js";

  while (true) {
    const now = Date.now();

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

    const p = ns.getPlayer();

    // 1. Rep-Werte der Fraktionen berechnen
    const currentFactionReps: Record<string, number> = {};
    for (const f of p.factions) {
      currentFactionReps[f] = ns.singularity.getFactionRep(f);
    }

    // 2. HIER DER FIX: Das komplette Objekt zuweisen, nicht nur den Namen!
    const nextRoadmapFaction = findNextRoadmapFaction(
      p,
      currentFactionReps,
      factionTargets as Record<string, number>,
    );

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

    const pServers = ns.cloud.getServerNames();
    const hasFormulas = ns.fileExists("Formulas.exe", "home");

    const canRunBatcher = hasFormulas && homeMaxRam >= BATCHER_MIN_RAM;

    // --- Vorherige Berechnungen ---
    const playerMoney = p.money;
    const factionRepMult = bnMults.FactionWorkRepGain ?? 1;
    const crimeMoneyMult = bnMults.CrimeMoney ?? 1;

    // 🎯 DYNAMISCHER FIX: Early-Game-Beschleunigung für Hacking-Einstiegsfraktionen
    let BASE_MONEY_THRESHOLD = factionRepMult < 0.5 ? 50_000_000 : 10_000_000;

    if (
      nextRoadmapFaction?.name === "CyberSec" ||
      nextRoadmapFaction?.name === "Tian Di Hui" ||
      nextRoadmapFaction?.name === "Netburners"
    ) {
      // Diese ersten Augments kosten fast nichts. Ein Limit von 1M reicht völlig aus,
      // um sofort in den Rep-Grind einzusteigen und das Hacking-Level zu pushen.
      BASE_MONEY_THRESHOLD = 1_000_000;
    }

    const lastStrategy = currentState?.strategy || "MONEY";
    const effectiveThreshold =
      lastStrategy === "REP"
        ? BASE_MONEY_THRESHOLD * 0.7
        : BASE_MONEY_THRESHOLD;

    const isReadyForFactionGrind = playerMoney > effectiveThreshold;
    // --- Nachfolgende Berechnungen ---

    for (const f of p.factions) {
      currentFactionReps[f] = ns.singularity.getFactionRep(f);
    }

    const factionToWorkFor = factionRepMult > 0.1 ? nextRoadmapFaction : null;
    const hasSavingTarget =
      factionToWorkFor !== null && !isReadyForFactionGrind;

    const maxPservers = ns.cloud.getServerLimit();
    const lacksPservers =
      pServers.length < maxPservers ||
      pServers.some((s) => ns.getServerMaxRam(s) < 64);
    const isRushActive = hasFormulas && homeMaxRam >= 256 && lacksPservers;

    const strategy = determineStrategy(
      ns,
      p,
      currentState,
      bnMults,
      currentKarma,
      isRushActive,
      canRunBatcher,
      factionTargets as Record<FactionName, number>,
      nextRoadmapFaction,
      factionToWorkFor,
      isReadyForFactionGrind,
    );

    let { mode, targetFaction, targetCompany, targetStat } = strategy;

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

    const previousStrategy = currentState?.strategy || "MONEY";

    if (mode !== previousStrategy) {
      if (!canRunBatcher && ns.isRunning("utils/fill-ram.js", "home")) {
        ns.scriptKill("utils/fill-ram.js", "home");
        logger.info("Batcher nicht ausführbar. 'fill-ram.js' beendet.");
      }

      const isOscillating =
        ["MONEY", "CRIME", "REP", "CORP", "TRAIN", "PSERV_RUSH"].includes(
          mode,
        ) &&
        ["MONEY", "CRIME", "REP", "CORP", "TRAIN", "PSERV_RUSH"].includes(
          previousStrategy,
        );

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
      targetVal = targetStat;
      label = `🏋️ Training (Combat)`;
    } else if (mode === "KILLS") {
      currentVal = p.numPeopleKilled;
      targetVal = targetStat;
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
      canRunBatcher,
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

    if (!canRunBatcher && ns.isRunning("utils/fill-ram.js", "home")) {
      ns.scriptKill("utils/fill-ram.js", "home");
      logger.info("Batcher nicht ausführbar. 'fill-ram.js' beendet.");
    }

    const isBatcherRunning = ns.isRunning(sysBatcherScript, "home");

    patchState(ns, {
      strategy: mode,
      targetFaction: targetFaction || undefined,
      targetCompany: targetCompany,
      targetStat: mode === "TRAIN" ? targetStat : undefined,
      targetKills: mode === "KILLS" ? targetStat : undefined,
      progressBar: finalBar,
      batcherActive: isBatcherRunning,

      ...(isBatcherRunning
        ? {}
        : {
            batcherProgress: "Inaktiv",
            batcherTarget: undefined,
            batcherRamNeeded: 0,
          }),

      fillerConfig: {
        shareMaxRamPercent: sharePercent,
        maxXpLevel: dynamicMaxXp,
      },
    });

    const isEarlyGameCrime =
      homeMaxRam < 128 &&
      (mode === "CRIME" || mode === "XP_SPRINT" || mode === "KILLS");

    if (isEarlyGameCrime) {
      if (ns.isRunning("tasks/faction-shopping.js", "home"))
        ns.scriptKill("tasks/faction-shopping.js", "home");
      const rogueScripts = ["systems/hacknet.js", "systems/hacknet-early.js"];
      for (const script of rogueScripts) {
        if (ns.fileExists(script, "home") && ns.isRunning(script, "home"))
          ns.scriptKill(script, "home");
      }
    } else {
      if (
        getFreeRam() > 12 &&
        !ns.isRunning("tasks/faction-shopping.js", "home")
      ) {
        ns.run("tasks/faction-shopping.js", 1);
      }
    }

    // Bestimme aktives und obsoletes Skript
    const workerScript =
      mode === "XP_SPRINT" ? scriptsList.xpfarm : scriptsList.worker;
    const obsoleteScript =
      mode === "XP_SPRINT" ? scriptsList.worker : scriptsList.xpfarm;

    const infectedServers = allNetworkServers.filter(
      (s) =>
        s !== "home" &&
        !pServers.includes(s) &&
        ns.hasRootAccess(s) &&
        ns.getServerMaxRam(s) > 0,
    );

    // --- 🚀 NEUE VEREINHEITLICHTE DEPLOYMENT LOGIK VIA DEPLOYWORKER ---
    if (canRunBatcher) {
      if (!ns.isRunning(sysBatcherScript, "home") && getFreeRam() > 15) {
        ns.run(sysBatcherScript, 1);
        logger.success(
          `🔥 System-Voraussetzungen erfüllt: '${sysBatcherScript}' gestartet.`,
        );
      }

      if (
        ns.isRunning(sysBatcherScript, "home") &&
        !ns.isRunning(sysDashboardScript, "home") &&
        getFreeRam() > 5
      ) {
        ns.run(sysDashboardScript, 1);
        logger.info(`📊 JIT-Dashboard automatisch gestartet.`);
      }

      // Wenn der High-End Batcher läuft, säubern wir alle Worker auf externen Hosts & Home
      const allAvailableHosts = [...infectedServers, ...pServers, "home"];
      for (const server of allAvailableHosts) {
        if (ns.isRunning(workerScript, server))
          ns.scriptKill(workerScript, server);
        if (ns.isRunning(obsoleteScript, server))
          ns.scriptKill(obsoleteScript, server);
      }
    } else {
      if (ns.isRunning(sysDashboardScript, "home")) {
        ns.scriptKill(sysDashboardScript, "home");
        logger.info(`⏹️ Dashboard beendet, da Batcher inaktiv.`);
      }

      // 1. Externe Flotte (Infected + Purchased Servers) vollständig via deployWorker steuern
      const workerFleet = [...infectedServers, ...pServers];
      for (const server of workerFleet) {
        deployWorker(
          ns,
          server,
          workerScript,
          cachedFallbackTarget,
          0,
          scriptsList,
        );
      }

      // 2. Home-Server dynamisch als Worker zuschalten (falls der Spieler nicht manuell beschäftigt ist)
      const homeShouldRunWorker = !["REP", "TRAIN", "CORP", "CRIME"].includes(
        mode,
      );
      if (homeShouldRunWorker) {
        const reservedRam =
          bnMults.ServerWeakenRate < 1.0
            ? Math.ceil(20 / bnMults.ServerWeakenRate)
            : 20;
        deployWorker(
          ns,
          "home",
          workerScript,
          cachedFallbackTarget,
          reservedRam,
          scriptsList,
        );
      } else {
        if (ns.isRunning(workerScript, "home"))
          ns.scriptKill(workerScript, "home");
        if (ns.isRunning(obsoleteScript, "home"))
          ns.scriptKill(obsoleteScript, "home");
      }
    }

    manageMicroservices(
      ns,
      mode,
      hasSavingTarget,
      logger,
      sysBatcherScript,
      targetStat,
    );

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

    await ns.sleep(2000);
  }
}

function manageMicroservices(
  ns: NS,
  currentMode: string,
  hasSavingTarget: boolean,
  logger: Logger,
  sysBatcherScript: string,
  targetStat?: number,
): void {
  const modeToScript: Record<string, string> = {
    REP: "tasks/faction-grind.js",
    CORP: "tasks/corp.js",
    TRAIN: "tasks/train.js",
    CRIME: "tasks/crime.js",
    XP_SPRINT: "tasks/crime.js",
    KILLS: "tasks/crime.js",
    PSERV_RUSH: "tasks/crime.js",
  };

  let targetScript = modeToScript[currentMode];

  if (
    currentMode === "MONEY" &&
    (hasSavingTarget || !ns.isRunning(sysBatcherScript, "home"))
  ) {
    targetScript = "tasks/crime.js";
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
