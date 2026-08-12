import { NS, FactionName, CompanyName } from "@ns";
import { generateProgressBar } from "/ui/ui-helper.js";
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
import { loadGangState, loadState } from "/lib/state.js";
import { loadBnMults } from "/lib/utils.js";
import { PATHS } from "/lib/paths.js";
import { BotStrategy } from "/lib/types/strategy.js";
import { TargetFactionResult } from "/lib/types/factions.js";

export interface SystemEvaluationResult {
  mode: BotStrategy;
  targetFaction: FactionName | null;
  targetCompany: CompanyName | null;
  targetStat: number | null;
  progressBar: string;
  isBN2GangMode: boolean;
  hasGang: boolean;
  gangFaction: FactionName | null;
  isGrindingNFG: boolean;
  hasSavingTarget: boolean;
  isReadyForFactionGrind: boolean;
  cachedFallbackTarget: string;
  fillerConfig: {
    shareMaxRamPercent: number;
    maxXpLevel: number;
  };
}

export class SystemStrategyEvaluator {
  private metricTracker = new MetricTracker();
  private cachedFallbackTarget = "n00dles";
  private lastFallbackUpdate = 0;
  private lastNetworkScan = 0;
  private lastCorpApplication = 0;
  private lastAugAnalysis = 0;
  private allNetworkServers: string[] = [];

  public evaluate(ns: NS, logger: Logger): SystemEvaluationResult {
    const now = Date.now();
    const currentState = loadState(ns);
    const p = ns.getPlayer();
    const bnMults = loadBnMults(ns);
    const gangState = loadGangState(ns);
    const gangFaction = gangState?.hasGang ? gangState.gangFaction : null;

    // 1️⃣ Netzwerk-Scan & Cache
    if (
      now - this.lastNetworkScan > REFRESH_INTERVALS.NETWORK_SCAN ||
      this.allNetworkServers.length === 0
    ) {
      const stateServers = currentState?.allServers;
      this.allNetworkServers =
        stateServers && stateServers.length > 0
          ? stateServers
          : getAllServers(ns);
      this.lastNetworkScan = now;
      logger.debug(
        `Netzwerk-Cache aktualisiert (${this.allNetworkServers.length} Server)`,
      );
    }

    // 2️⃣ Augmentation-Analyse Trigger
    if (
      (now - this.lastAugAnalysis > 300_000 || !currentState?.augRoadMap) &&
      ns.fileExists(PATHS.tasks.analyzeAug, "home")
    ) {
      ns.run(PATHS.tasks.analyzeAug, 1);
      this.lastAugAnalysis = now;
      logger.debug("Augmentation-Analyse gestartet (analyze-augs)");
    }

    // 4️⃣ Factions & Roadmap-Bestimmung
    const isBN2GangMode =
      currentState?.isBN2GangMode ?? isGangOfferingAllAugs(ns);
    const currentCity = CITY_FACTIONS.find((c) => p.factions.includes(c));
    const augRoadmap = currentState?.augRoadMap ?? [];

    // 🔍 LOG 1: Roadmap & Spieler-Kontext (Fix: p.factions.join(", "))
    logger.debug("[STRATEGY] Augmentation-Roadmap Status", undefined, {
      context: {
        hasState: !!currentState,
        roadmapLength: augRoadmap.length,
        roadmapFirstEntry: augRoadmap[0]?.name ?? "Keine",
        roadmapFirstFaction: augRoadmap[0]?.bestFaction ?? "Keine",
        playerFactions: p.factions.join(", "),
        currentCityFaction: currentCity ?? "Keine",
        isBN2GangMode,
      },
    });

    const nextRoadmapFaction = findNextRoadmapFaction(
      ns,
      augRoadmap,
      gangFaction,
      currentCity,
    );

    // 🔍 LOG 2: Ergebnis von findNextRoadmapFaction (Fix: Rep direkt über Singularity lesen)
    logger.debug("[STRATEGY] findNextRoadmapFaction Ergebnis", undefined, {
      context: {
        targetName: nextRoadmapFaction?.name ?? "null",
        targetRep: nextRoadmapFaction?.targetRep ?? 0,
        currentRep: nextRoadmapFaction
          ? ns.singularity.getFactionRep(nextRoadmapFaction.name as FactionName)
          : 0,
        isNFG: nextRoadmapFaction?.isNFG ?? false,
      },
    });

    const factionTargets = (currentState?.factionTargets ?? {}) as Partial<
      Record<FactionName, number>
    >;
    if (nextRoadmapFaction) {
      factionTargets[nextRoadmapFaction.name as FactionName] =
        nextRoadmapFaction.targetRep;
    }

    const currentFactionReps: Record<string, number> = {};
    for (const f of p.factions) {
      currentFactionReps[f] = ns.singularity.getFactionRep(f);
    }

    // 3️⃣ Megacorp Bewerbungen
    if (
      p.skills.hacking >= 250 &&
      now - this.lastCorpApplication > REFRESH_INTERVALS.MEGACORP_APPLY
    ) {
      applyToAllMegacorps(ns, p, logger);
      this.lastCorpApplication = now;
    }

    // 5️⃣ Schwellenwerte & Faction-Bereitschaft
    const factionRepMult = bnMults.FactionWorkRepGain ?? 1;
    const crimeMoneyMult = bnMults.CrimeMoney ?? 1;
    const activeBatchStrategy = currentState?.batchStrategy;

    const isBatcherActive =
      activeBatchStrategy === "SHOTGUN_HWGW" ||
      activeBatchStrategy === "JIT_HWGW" ||
      activeBatchStrategy === "WORKER";

    let baseMoneyThreshold = factionRepMult < 0.5 ? 50_000_000 : 10_000_000;
    if (
      nextRoadmapFaction?.name === "CyberSec" ||
      nextRoadmapFaction?.name === "Tian Di Hui" ||
      nextRoadmapFaction?.name === "Netburners"
    ) {
      baseMoneyThreshold = 1_000_000;
    }

    const lastStrategy = currentState?.strategy || "MONEY";
    const effectiveThreshold =
      lastStrategy === "REP" ? baseMoneyThreshold * 0.7 : baseMoneyThreshold;

    const isMemberOfTarget = nextRoadmapFaction
      ? p.factions.includes(nextRoadmapFaction.name as FactionName)
      : false;

    const isReadyForFactionGrind =
      isBatcherActive || isMemberOfTarget || p.money > effectiveThreshold;

    const isDaedalus = nextRoadmapFaction?.name === "Daedalus";

    // Prüfen, ob die Ziel-Fraktion gefiltert wird
    const factionToWorkFor: TargetFactionResult | null =
      (!isBN2GangMode || isDaedalus || nextRoadmapFaction !== null) &&
      factionRepMult > 0.1
        ? nextRoadmapFaction
        : null;

    const hasSavingTarget =
      factionToWorkFor !== null && !isReadyForFactionGrind;
    const isOrchestratorRunning = ns.isRunning(
      PATHS.daemons.hackingOrchestrator,
      "home",
    );

    // 🔍 LOG 3: Faction-Readiness & Arbeitsziel
    logger.debug("[STRATEGY] Faction-Readiness Evaluierung", undefined, {
      context: {
        nextFactionName: nextRoadmapFaction?.name ?? "Keine",
        isMemberOfTarget,
        isBatcherActive,
        batchStrategy: activeBatchStrategy ?? "Keine",
        playerMoney: Math.round(p.money),
        threshold: effectiveThreshold,
        isReadyForFactionGrind,
        factionRepMult,
        factionToWorkFor: factionToWorkFor?.name ?? "null (Gefiltert)",
      },
    });

    // 6️⃣ Strategie ermitteln
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

    // 🔍 LOG 4: Primäre Strategieentscheidung
    logger.debug("[STRATEGY] determineStrategy Ausgangs-Ergebnis", undefined, {
      context: {
        mode: strategy.mode,
        targetFaction: strategy.targetFaction ?? "null",
        targetCompany: strategy.targetCompany ?? "null",
        targetStat: strategy.targetStat ?? "null",
      },
    });

    // Nur in den Fallback MONEY schalten, wenn REP gefordert ist, aber kein Faction-Target existiert
    if (isBN2GangMode && strategy.mode === "REP" && !factionToWorkFor) {
      logger.debug(
        "BN2 Gang Mode aktiv: Kein Faction-Target für REP. Fallback auf MONEY.",
      );
      strategy = { mode: "MONEY" };
    }

    const {
      mode,
      targetFaction = null,
      targetCompany = null,
      targetStat = null,
    } = strategy;

    // 7️⃣ Fallback Target Caching
    if (
      now - this.lastFallbackUpdate > REFRESH_INTERVALS.FALLBACK_TARGET ||
      this.cachedFallbackTarget === "n00dles"
    ) {
      this.cachedFallbackTarget = findBestTarget(
        ns,
        this.allNetworkServers,
        p.skills.hacking,
        bnMults,
        currentState?.batcherTarget ?? null,
      );
      this.lastFallbackUpdate = now;
    }

    // 8️⃣ Progress & UI Bar Generierung
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
    } else if (mode === "KARMA") {
      currentVal = Math.abs((ns as any).heart?.break() ?? 0);
      targetVal = 54_000;
      label = `😈 Karma Rush (-54k)`;
    } else if (mode === "BLADEBURNER") {
      currentVal = ns.bladeburner?.getRank() ?? 0;
      targetVal = 0;
      label = `⚔️ Bladeburner Ops`;
    } else if (mode === "DOMINION") {
      currentVal = p.skills.hacking;
      targetVal = targetStat ?? 3000;
      label = `🌐 DOMINION Rush (w0r1d_d43m0n)`;
    } else if (mode === "CHURCH") {
      currentVal = 0;
      targetVal = 0;
      label = `⛩️ Church / Stanek`;
    }

    this.metricTracker.update(
      mode,
      currentVal,
      targetVal,
      (oldMode, newMode) => {
        logger.info(
          `🔄 Strategiewechsel: ${oldMode || "START"} ➔ ${newMode} ${label ? `(${label})` : ""}`,
          undefined,
          {
            context: {
              oldMode: oldMode || "START",
              newMode,
              targetFaction: targetFaction ?? "Keine",
              targetCompany: targetCompany ?? "Keine",
            },
          },
        );
      },
    );

    const etaStr = this.metricTracker.getEtaString(mode, currentVal, targetVal);
    const hasFormulas = ns.fileExists("Formulas.exe", "home");

    const progressBar = generateProgressBar(ns, {
      mode,
      label,
      currentVal,
      targetVal,
      etaStr,
      targetFaction: targetFaction ?? null,
      playerMoney: p.money,
      effectiveThreshold,
      cachedFallbackTarget: this.cachedFallbackTarget,
      hasFormulas,
      canRunBatcher: isOrchestratorRunning,
      factionToWorkFor,
      isReadyForFactionGrind,
      crimeMoneyMult,
      currentState,
    });

    // Dynamic Filler Config
    const sharePercent =
      mode === "REP"
        ? 0.4
        : mode === "UNI"
          ? 0.5
          : mode === "DOMINION"
            ? 0.9 // High-Priority XP Share während DOMINION
            : mode === "CHURCH"
              ? 0.8
              : mode === "MONEY"
                ? 0.1
                : 0.0;

    const dynamicMaxXp =
      mode === "CRIME" || mode === "KARMA"
        ? 100
        : mode === "UNI" || mode === "DOMINION"
          ? (targetStat ?? 3000)
          : p.skills.hacking > 800
            ? 1500
            : 1000;

    return {
      mode,
      targetFaction,
      targetCompany: targetCompany ?? null,
      targetStat,
      progressBar,
      isBN2GangMode,
      hasGang: gangState?.hasGang ?? false,
      gangFaction: gangFaction ?? null,
      isGrindingNFG: nextRoadmapFaction?.isNFG ?? false,
      hasSavingTarget,
      isReadyForFactionGrind,
      cachedFallbackTarget: this.cachedFallbackTarget,
      fillerConfig: {
        shareMaxRamPercent: sharePercent,
        maxXpLevel: dynamicMaxXp,
      },
    };
  }
}
