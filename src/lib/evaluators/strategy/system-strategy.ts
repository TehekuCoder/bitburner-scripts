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
    }

    // 2️⃣ Augmentation-Analyse Trigger
    if (
      (now - this.lastAugAnalysis > 300_000 || !currentState?.augRoadMap) &&
      ns.fileExists(PATHS.tasks.analyzeAug, "home")
    ) {
      ns.run(PATHS.tasks.analyzeAug, 1);
      this.lastAugAnalysis = now;
    }

    // 3️⃣ Megacorp Bewerbungen
    if (
      p.skills.hacking >= 250 &&
      now - this.lastCorpApplication > REFRESH_INTERVALS.MEGACORP_APPLY
    ) {
      applyToAllMegacorps(ns, p, logger);
      this.lastCorpApplication = now;
    }

    // 4️⃣ Factions & Roadmap-Bestimmung
    const isBN2GangMode =
      currentState?.isBN2GangMode ?? isGangOfferingAllAugs(ns);
    const currentCity = CITY_FACTIONS.find((c) => p.factions.includes(c));
    const augRoadmap = currentState?.augRoadMap ?? [];
    const nextRoadmapFaction = findNextRoadmapFaction(
      ns,
      augRoadmap,
      gangFaction,
      currentCity,
    );

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

    // 5️⃣ Schwellenwerte & Faction-Bereitschaft
    const factionRepMult = bnMults.FactionWorkRepGain ?? 1;
    const crimeMoneyMult = bnMults.CrimeMoney ?? 1;
    const activeBatchStrategy = currentState?.batchStrategy;
    const isBatcherActive =
      activeBatchStrategy === "SHOTGUN_HWGW" ||
      activeBatchStrategy === "JIT_HWGW";

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

    const isReadyForFactionGrind =
      isBatcherActive || p.money > effectiveThreshold;

    const isDaedalus = nextRoadmapFaction?.name === "Daedalus";
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

    // Nur in den Fallback MONEY schalten, wenn REP gefordert ist, aber kein Faction-Target existiert
    if (isBN2GangMode && strategy.mode === "REP" && !factionToWorkFor) {
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

    // 8️⃣ Progress & UI Bar Generierung (Inklusive Karma, Bladeburner & Church)
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
          : mode === "CHURCH"
            ? 0.8
            : mode === "MONEY"
              ? 0.1
              : 0.0;
    const dynamicMaxXp =
      mode === "CRIME" || mode === "KARMA"
        ? 100
        : mode === "UNI"
          ? 3000
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
