import { NS, Player, FactionName, CompanyName } from "@ns";
import { loadState, patchState, BotStrategy } from "./state-manager.js"; 
import { breakAndInfectNetwork, getAllServers } from "../lib/network.js";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js";
import { Logger } from "./logger.js";

interface FactionConfig {
  name: FactionName;
  minStat: number;
  priority: number;
}

// --- CONFIGURATION CONSTANTS ---
const REFRESH_INTERVALS = {
  REP_CACHE: 900_000, // 15 Min.
  MEGACORP_APPLY: 600_000, // 10 Min.
  FALLBACK_TARGET: 300_000, // 5 Min.
  STRATEGY_COOLDOWN: 60_000, // 1 Min. Schonfrist für Oszillation
  NETWORK_SCAN: 20_000, // 🛠️ NEU: Nur alle 20 Sek. das Netzwerk scannen/infizieren
};

const BATCHER_MIN_RAM = 256;

const COMBAT_STATS: (keyof Player["skills"])[] = [
  "strength",
  "defense",
  "dexterity",
  "agility",
];

const MEGACORPS: Record<string, CompanyName> = {
  ECorp: "ECorp",
  MegaCorp: "MegaCorp",
  "KuaiGong International": "KuaiGong International",
  "Four Sigma": "Four Sigma",
  NWO: "NWO",
  "Blade Industries": "Blade Industries",
  "OmniTek Incorporated": "OmniTek Incorporated",
  "Bachman & Associates": "Bachman & Associates",
  "Clarke Incorporated": "Clarke Incorporated",
  "Fulcrum Secret Technologies": "Fulcrum Technologies",
};

const HACKING_FACTIONS: FactionConfig[] = [
  { name: "CyberSec", minStat: 0, priority: 1 },
  { name: "Tian Di Hui", minStat: 0, priority: 2 },
  { name: "Netburners", minStat: 0, priority: 3 },
  { name: "NiteSec", minStat: 0, priority: 4 },
  { name: "Slum Snakes", minStat: 30, priority: 5 },
  { name: "Sector-12", minStat: 0, priority: 6 },
  { name: "Chongqing", minStat: 0, priority: 7 },
  { name: "Ishima", minStat: 0, priority: 8 },
  { name: "New Tokyo", minStat: 0, priority: 9 },
  { name: "Tetrads", minStat: 75, priority: 10 },
  { name: "The Black Hand", minStat: 0, priority: 11 },
  { name: "Aevum", minStat: 0, priority: 12 },
  { name: "Volhaven", minStat: 0, priority: 13 },
  { name: "The Syndicate", minStat: 200, priority: 14 },
  { name: "BitRunners", minStat: 0, priority: 15 },
  { name: "ECorp", minStat: 0, priority: 16 },
  { name: "MegaCorp", minStat: 0, priority: 17 },
  { name: "KuaiGong International", minStat: 0, priority: 18 },
  { name: "Four Sigma", minStat: 0, priority: 19 },
  { name: "NWO", minStat: 0, priority: 20 },
  { name: "Blade Industries", minStat: 0, priority: 21 },
  { name: "OmniTek Incorporated", minStat: 0, priority: 22 },
  { name: "Bachman & Associates", minStat: 0, priority: 23 },
  { name: "Clarke Incorporated", minStat: 0, priority: 24 },
  { name: "Fulcrum Secret Technologies", minStat: 0, priority: 25 },
  { name: "Silhouette", minStat: 0, priority: 26 },
  { name: "The Dark Army", minStat: 300, priority: 27 },
  { name: "Speakers for the Dead", minStat: 300, priority: 28 },
  { name: "The Covenant", minStat: 850, priority: 29 },
  { name: "Illuminati", minStat: 1200, priority: 30 },
  { name: "Daedalus", minStat: 1500, priority: 31 },
];

const repCache: Record<string, number> = {};

const CITY_FACTIONS: FactionName[] = [
  "Sector-12" as FactionName,
  "Aevum" as FactionName,
  "Chongqing" as FactionName,
  "New Tokyo" as FactionName,
  "Ishima" as FactionName,
  "Volhaven" as FactionName,
];


export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Dispatcher", "INFO");

  if (ns.singularity === undefined) {
    logger.error("Kritischer Systemfehler: Singularity-API (SF4) fehlt!");
    ns.tprint("🛑 [Dispatcher] Kritischer Fehler: Singularity-API (SF4) fehlt!");
    return;
  }

  logger.info("Initialisiere Netzwerk-Multiplikatoren und Reputations-Cache...");
  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;
  buildReputationCache(ns);

  let lastValue = 0;
  let lastTime = Date.now();
  let emaRate = 0;
  let lastMode = "";

  let cachedFallbackTarget = "n00dles";
  let lastFallbackUpdate = 0;
  let lastCacheRefresh = Date.now();
  let modeLockTime = 0; 
  let lastCorpApplication = 0;

  // 🛠️ Caching für Netzwerk-Scans initialisieren
  let allNetworkServers: string[] = [];
  let lastNetworkScan = 0;

  while (true) {
    const now = Date.now();

    // --- CACHE REFRESH ---
    if (now - lastCacheRefresh > REFRESH_INTERVALS.REP_CACHE) {
      buildReputationCache(ns);
      lastCacheRefresh = now;
      logger.info("Reputations-Cache routinemäßig aktualisiert.");
    }

    // --- 🛠️ THROTTLED NETZWERK SCAN ---
    // Verhindert massiven CPU-Overhead durch ständiges Nuken und Suchen im Sekundentakt
    if (now - lastNetworkScan > REFRESH_INTERVALS.NETWORK_SCAN || allNetworkServers.length === 0) {
      breakAndInfectNetwork(ns);
      allNetworkServers = getAllServers(ns);
      lastNetworkScan = now;
    }

    const currentState = loadState(ns);
    let mode: BotStrategy = "MONEY";
    const p = ns.getPlayer();

    // Zentralisiertes Home-RAM Tracking pro Tick
    const homeMaxRam = ns.getServerMaxRam("home");
    const getFreeRam = () => homeMaxRam - ns.getServerUsedRam("home");
    
    // 🛠️ Typensicherer Aufruf für die undokumentierte Karma-API
    const currentKarma = (ns as any).heart?.break() ?? 0;

    if (
      p.skills.hacking >= 250 &&
      now - lastCorpApplication > REFRESH_INTERVALS.MEGACORP_APPLY
    ) {
      applyToAllMegacorps(ns, p, logger);
      lastCorpApplication = now;
    }

    // --- 0. INFRASTRUKTUR VORABBERECHNUNG ---
    const pServers = ns.cloud.getServerNames();
    const hasFormulas = ns.fileExists("Formulas.exe", "home");

    // Maximalen RAM-Riegel im gehackten Netzwerk ermitteln
    const maxNetworkRam = allNetworkServers.reduce((max, s) => {
      if (!ns.hasRootAccess(s) || pServers.includes(s) || s === "home") return max;
      const ram = ns.getServerMaxRam(s);
      return ram > max ? ram : max;
    }, 0);

    // Batcher darf zünden, wenn Formulas da ist UND entweder Home groß genug ist ODER das Netzwerk nutzbaren RAM bietet
    const canRunBatcher = hasFormulas && (homeMaxRam >= BATCHER_MIN_RAM || maxNetworkRam >= 32);

    // --- 1. DYNAMISCHE STRATEGIE-MATRIX ---
    const playerMoney = p.money;
    const factionRepMult = bnMults.FactionWorkRepGain ?? 1;
    const companyRepMult = bnMults.CompanyWorkRepGain ?? 1;
    const crimeMoneyMult = bnMults.CrimeMoney ?? 1;

    const BASE_MONEY_THRESHOLD = factionRepMult < 0.5 ? 50_000_000 : 10_000_000;
    const lastStrategy = currentState?.strategy || "MONEY";
    const effectiveThreshold = lastStrategy === "REP" ? BASE_MONEY_THRESHOLD * 0.7 : BASE_MONEY_THRESHOLD;

    const isReadyForFactionGrind = playerMoney > effectiveThreshold;

    const currentFactionReps: Record<string, number> = {};
    for (const f of p.factions) {
      currentFactionReps[f] = ns.singularity.getFactionRep(f);
    }

    const nextRoadmapFaction = findNextRoadmapFaction(p, currentFactionReps);
    const roadmapFactionName = nextRoadmapFaction ? nextRoadmapFaction.name : null;
    const factionToWorkFor = factionRepMult > 0.1 ? nextRoadmapFaction : null;
    
    const hasSavingTarget = factionToWorkFor !== null && !isReadyForFactionGrind;

    let targetFaction: FactionName | null = roadmapFactionName && p.factions.includes(roadmapFactionName) ? roadmapFactionName : null;
    let targetCompany: CompanyName | undefined = undefined;
    let targetStat = 0;

    // Prüfen, ob wir überhaupt noch PServers kaufen/upgraden müssen
    const maxPservers = ns.cloud.getServerLimit();
    const lacksPservers = pServers.length < maxPservers || pServers.some(s => ns.getServerMaxRam(s) < 64);
    const isRushActive = hasFormulas && homeMaxRam >= 256 && lacksPservers;

    // --- STRATEGIE-ENTSCHEIDUNGSBAUM ---
    if (p.skills.hacking < 50) {
      mode = "XP_SPRINT";
    } else if (nextRoadmapFaction && roadmapFactionName) {
      const isMember = p.factions.includes(roadmapFactionName);
      const isCombatFaction =
        nextRoadmapFaction.minStat > 0 ||
        ["Slum Snakes", "Tetrads", "The Syndicate", "The Dark Army", "Speakers for the Dead"].includes(roadmapFactionName);

      if (!isMember) {
        targetFaction = roadmapFactionName;

        if (roadmapFactionName === "Slum Snakes" && currentKarma > -9) {
          mode = "CRIME";
        } else if (roadmapFactionName === "Tetrads" && currentKarma > -18) {
          mode = "CRIME";
        } else if (roadmapFactionName === "The Syndicate" && currentKarma > -90) {
          mode = "CRIME";
        } else if (roadmapFactionName === "The Dark Army" && p.numPeopleKilled < 5) {
          mode = "KILLS";
          targetStat = 5;
        } else if (roadmapFactionName === "Speakers for the Dead" && p.numPeopleKilled < 30) {
          mode = "KILLS";
          targetStat = 30;
        } else if (
          nextRoadmapFaction.minStat > 0 &&
          Math.min(...COMBAT_STATS.map((s) => p.skills[s])) < nextRoadmapFaction.minStat
        ) {
          mode = "TRAIN";
          targetStat = nextRoadmapFaction.minStat;
        } else if (isRushActive) {
          mode = "PSERV_RUSH"; 
        } else {
          mode = "MONEY";
        }
      } else {
        if (isReadyForFactionGrind || isCombatFaction) {
          mode = "REP";
          targetFaction = roadmapFactionName;
          targetStat = nextRoadmapFaction.minStat;
        } else if (isRushActive) {
          mode = "PSERV_RUSH"; 
        } else {
          mode = "MONEY";
        }
      }
    } else if (isRushActive) {
      mode = "PSERV_RUSH"; 
    } else if (p.skills.hacking >= 250 && companyRepMult > 0.1) {
      const needsSilhouette = !p.factions.includes("Silhouette" as FactionName) && (repCache["Silhouette"] ?? 0) > 0;
      const isExecutive = Object.values(p.jobs).some((title) =>
        ["Chief Technology Officer", "Chief Financial Officer", "Chief Executive Officer"].includes(title),
      );
      const hasEnoughKarma = currentKarma <= -22;

      if (needsSilhouette && (!isExecutive || !hasEnoughKarma)) {
        if (!hasEnoughKarma) {
          mode = "CRIME";
        } else {
          mode = "CORP";
          const currentCorpJob = Object.keys(p.jobs).find((corp) => MEGACORPS[corp] !== undefined);
          targetCompany = currentCorpJob ? MEGACORPS[currentCorpJob] : Object.values(MEGACORPS)[0];
        }
      } else {
        const missingCorpFaction = HACKING_FACTIONS.find(
          (f) =>
            !p.factions.includes(f.name) &&
            MEGACORPS[f.name] !== undefined &&
            ns.singularity.getCompanyRep(MEGACORPS[f.name]) < 400_000 &&
            (repCache[f.name] ?? 0) > 0,
        );

        if (missingCorpFaction) {
          mode = "CORP";
          targetCompany = MEGACORPS[missingCorpFaction.name];
        } else {
          mode = "MONEY";
        }
      }
    } else if (homeMaxRam < 256 || (crimeMoneyMult > 5 && !canRunBatcher)) {
      mode = "CRIME";
    } else {
      mode = "MONEY";
    }

    // Optionaler Combat-Faction-Fokus
    if (mode === "MONEY" && pServers.length > 0) {
      const FOCUS_ON_COMBAT_FACTIONS = false;

      if (FOCUS_ON_COMBAT_FACTIONS) {
        const nextLockedCombatFaction = HACKING_FACTIONS.find((f) => !p.factions.includes(f.name) && f.minStat > 0);

        if (nextLockedCombatFaction) {
          let requiredKills = 0;
          if (nextLockedCombatFaction.name === "The Dark Army") requiredKills = 5;
          if (nextLockedCombatFaction.name === "Speakers for the Dead") requiredKills = 30;

          const currentLowestCombatStat = Math.min(...COMBAT_STATS.map((s) => p.skills[s]));

          if (p.numPeopleKilled < requiredKills) {
            mode = "KILLS";
            targetStat = requiredKills;
            targetFaction = nextLockedCombatFaction.name;
          } else if (currentLowestCombatStat < nextLockedCombatFaction.minStat) {
            mode = "TRAIN";
            targetStat = nextLockedCombatFaction.minStat;
            targetFaction = nextLockedCombatFaction.name;
          }
        }
      }
    }

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
      const isOscillating = ["MONEY", "CRIME", "REP", "CORP", "TRAIN", "PSERV_RUSH"].includes(mode) &&
                            ["MONEY", "CRIME", "REP", "CORP", "TRAIN", "PSERV_RUSH"].includes(previousStrategy);

      if (isOscillating && now - modeLockTime < REFRESH_INTERVALS.STRATEGY_COOLDOWN) {
        mode = previousStrategy as BotStrategy;
        if (mode === "REP") targetFaction = currentState?.targetFaction || null;
        if (mode === "CORP") targetCompany = currentState?.targetCompany;
        if (mode === "TRAIN") targetStat = currentState?.targetStat || 0;
      } else {
        modeLockTime = now;
      }
    }

    // --- 2. METRIK-ERFASSUNG & EMA ETA ENGINE ---
    let currentVal = 0;
    let targetVal = 0;
    let label = "";

    if (mode === "REP" && targetFaction) {
      currentVal = currentFactionReps[targetFaction] ?? ns.singularity.getFactionRep(targetFaction);
      targetVal = repCache[targetFaction] || 0;
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

    if (mode !== lastMode) {
      logger.info(`🔄 Strategiewechsel initiiert: ${lastMode || "START"} ➔ ${mode} ${label ? `(${label})` : ""}`);
      lastValue = currentVal;
      lastTime = now;
      emaRate = 0;
      lastMode = mode;
    } else if (targetVal > 0) {
      const timeDiff = now - lastTime;
      if (timeDiff >= 4000) {
        const valDiff = currentVal - lastValue;
        if (valDiff > 0) {
          const instantRate = valDiff / (timeDiff / 1000);
          emaRate = emaRate === 0 ? instantRate : emaRate * 0.7 + instantRate * 0.3;
        }
        lastValue = currentVal;
        lastTime = now;
      }
    }

    let etaStr = "Berechne...";
    if (targetVal === 0 && ["REP", "CORP", "TRAIN"].includes(mode)) {
      etaStr = "Fertig (Max)"; 
    } else if (emaRate > 0) {
      const remaining = targetVal - currentVal;
      if (remaining <= 0) {
        etaStr = "Fertig";
      } else {
        const secondsLeft = remaining / emaRate;
        if (secondsLeft > 3600) {
          etaStr = `${Math.floor(secondsLeft / 3600)}h ${Math.floor((secondsLeft % 3600) / 60)}m`;
        } else if (secondsLeft > 60) {
          etaStr = `${Math.floor(secondsLeft / 60)}m ${Math.floor(secondsLeft % 60)}s`;
        } else {
          etaStr = `${Math.ceil(secondsLeft)}s`;
        }
      }
    }
    // --- 3. UI DASHBOARD UPDATE ---
    let generatedBar = "";
    if (["REP", "CORP", "TRAIN"].includes(mode) && targetVal > 0) {
      const pct = ((currentVal / targetVal) * 100).toFixed(1);
      generatedBar = `${label} | ${ns.format.number(currentVal, 1)}/${ns.format.number(targetVal, 1)} (${pct}%) | ETA: ${etaStr}`;
    } else if (targetVal === 0 && mode === "REP" && targetFaction) {
      generatedBar = `🥷 ${targetFaction} | Karma/Gang Grind aktiv`;
    } else if (mode === "XP_SPRINT") {
      generatedBar = "👶 Early Game: XP SPRINT (Hacking < 50)";
    } else if (mode === "CRIME") {
      generatedBar = crimeMoneyMult > 5 ? "🥷 BN-Synergie: Dauerhafter Crime Loop aktiv (Mörderischer Profit)" : "🥷 Mid-Game-Crime Loop für stabiles Einkommen";
    } else if (mode === "PSERV_RUSH") {
      const pservCost = ns.cloud.getServerCost(64);
      const rushProgress = ((playerMoney / pservCost) * 100).toFixed(1);
      generatedBar = canRunBatcher 
        ? `🚀 BATCHER AKTIV (Netzwerk) | Cash: ${ns.format.number(playerMoney, 1)} / ${ns.format.number(pservCost, 0)} $ (${rushProgress}%)`
        : `🚀 BATCHER RUSH aktiv | Cash: ${ns.format.number(playerMoney, 1)} / ${ns.format.number(pservCost, 0)} $ (${rushProgress}%) | Warte auf Infrastruktur`;
    } else if (mode === "KILLS") {
      generatedBar = `💀 Eliminierungs-Aufträge active (${currentVal}/${targetVal} Kills)`;
    } else if (mode === "MONEY" && !canRunBatcher) {
      if (!hasFormulas) {
        generatedBar = `🏗️ Aufbau-Phase: Generiere Geld auf ${cachedFallbackTarget} (Warte auf Formulas.exe)`;
      } else {
        generatedBar = `🏗️ Aufbau-Phase: Generiere Geld auf ${cachedFallbackTarget} (Warte auf Server mit 32GB+ RAM)`;
      }
    } else {
      if (factionToWorkFor) {
        if (isReadyForFactionGrind) {
          generatedBar = `⏳ Bereit für ${factionToWorkFor.name} | Warte auf Beitritt/Einladung`;
        } else {
          const progressPct = ((playerMoney / effectiveThreshold) * 100).toFixed(1);
          generatedBar = `💰 Spare für ${factionToWorkFor.name}: ${ns.format.number(playerMoney, 1)} / ${ns.format.number(effectiveThreshold, 0)} $ (${progressPct}%)`;
        }
      } else {
        generatedBar = "💰 Maximiere Profit (Batcher)";
      }
    }
    let finalBar = generatedBar;

    if (
      (mode === "CRIME" || mode === "XP_SPRINT") &&
      ns.isRunning("tasks/crime.js", "home")
    ) {
      if (currentState?.progressBar?.startsWith("🥷")) {
        finalBar = currentState.progressBar;
      }
    }

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
      logger.info("Batcher nicht ausführbar. 'fill-ram.js' vorsorglich beendet.");
    }

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

    const isEarlyGameCrime = homeMaxRam < 128 && (mode === "CRIME" || mode === "XP_SPRINT" || mode === "KILLS");

    if (isEarlyGameCrime) {
      if (ns.isRunning("tasks/faction-shopping.js", "home")) ns.scriptKill("tasks/faction-shopping.js", "home");
      const rogueScripts = ["systems/hacknet.js", "systems/hacknet-early.js"];
      for (const script of rogueScripts) {
        if (ns.fileExists(script, "home") && ns.isRunning(script, "home")) ns.scriptKill(script, "home");
      }
    } else {
      if (getFreeRam() > 12 && !ns.isRunning("tasks/faction-shopping.js", "home")) {
        ns.run("tasks/faction-shopping.js", 1);
      }
    }

    // --- 4. STRATEGIE-AWARE WORKER ALLOKATION ---
    const workerScript = mode === "XP_SPRINT" ? "tasks/xp-grind.js" : "tasks/work.js";
    const obsoleteScript = mode === "XP_SPRINT" ? "tasks/work.js" : "tasks/xp-grind.js";

    const infectedServers = allNetworkServers.filter((s) => 
      s !== "home" && !pServers.includes(s) && ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0
    );

    let workerFleet: string[] = [];

    if (canRunBatcher) {
      if (!ns.isRunning("core/sys-batcher.js", "home") && getFreeRam() > 15) {
        ns.run("core/sys-batcher.js", 1);
        logger.success("🔥 System-Voraussetzungen erfüllt: 'sys-batcher.js' gestartet.");
      }

      const allAvailableHosts = [...infectedServers, ...pServers];
      for (const server of allAvailableHosts) {
        if (ns.isRunning(workerScript, server)) ns.scriptKill(workerScript, server);
        if (ns.isRunning(obsoleteScript, server)) ns.scriptKill(obsoleteScript, server);
      }
    } else {
      workerFleet = [...infectedServers, ...pServers];

      // 🛠️ OPTIMIERT: ns.ps() wird nur noch aufgerufen, wenn der Worker tatsächlich läuft
      for (const server of workerFleet) {
        if (ns.isRunning(obsoleteScript, server)) {
          ns.scriptKill(obsoleteScript, server);
        }

        if (ns.isRunning(workerScript, server)) {
          const runningProc = ns.ps(server).find((proc) => proc.filename === workerScript);
          if (runningProc && runningProc.args[0] !== cachedFallbackTarget) {
            ns.scriptKill(workerScript, server);
          }
        }
      }

      dispatchSimpleTask(ns, workerFleet, workerScript, cachedFallbackTarget, Infinity, bnMults);
    }

    const homeShouldRunWorker = !["REP", "TRAIN", "CORP", "CRIME"].includes(mode) && !canRunBatcher;
    if (!homeShouldRunWorker) {
      if (ns.isRunning(workerScript, "home")) {
        ns.scriptKill(workerScript, "home");
      }
    } else {
      let isWorkerRunningWithCorrectTarget = false;
      if (ns.isRunning(workerScript, "home")) {
        const homeProc = ns.ps("home").find((proc) => proc.filename === workerScript);
        if (homeProc && homeProc.args[0] !== cachedFallbackTarget) {
          ns.scriptKill(workerScript, "home");
        } else {
          isWorkerRunningWithCorrectTarget = true;
        }
      }

      const homeFreeRam = getFreeRam();
      const reservedRam = bnMults.ServerWeakenRate < 1.0 ? Math.ceil(20 / bnMults.ServerWeakenRate) : 20;
      const workerRam = ns.getScriptRam(workerScript);

      if (homeFreeRam > reservedRam + workerRam && !isWorkerRunningWithCorrectTarget) {
        const homeThreads = Math.floor((homeFreeRam - reservedRam) / workerRam);
        if (homeThreads > 0) {
          ns.run(workerScript, homeThreads, cachedFallbackTarget);
        }
      }
    }

    const isRamReady = homeMaxRam >= 256 || (pServers.length > 0 && Math.max(...pServers.map((s) => ns.getServerMaxRam(s))) >= 64);
    const executionAllowed = !hasFormulas || ns.isRunning("core/sys-batcher.js", "home");

    if (
      isRamReady &&
      !isEarlyGameCrime &&
      executionAllowed &&
      !ns.isRunning("utils/fill-ram.js", "home") &&
      getFreeRam() > 15
    ) {
      ns.run("utils/fill-ram.js", 1);
    }

    manageMicroservices(ns, mode, hasSavingTarget, logger, targetStat);

    if (mode === "MONEY" && !hasSavingTarget && canRunBatcher) {
      if (ns.singularity.getCurrentWork()) {
        logger.info("Batcher läuft ohne offene Sparziele. Manuelle Arbeit gestoppt.");
        ns.singularity.stopAction();
      }
    }

    await ns.sleep(2000);
  }
}

function buildReputationCache(ns: NS): void {
  const ownedAugs = ns.singularity.getOwnedAugmentations(true);

  for (const faction of HACKING_FACTIONS) {
    let highest = 0;
    try {
      const augs = ns.singularity.getAugmentationsFromFaction(faction.name);
      for (const aug of augs) {
        if (!ownedAugs.includes(aug) && aug !== "NeuroFlux Governor") {
          const req = ns.singularity.getAugmentationRepReq(aug);
          if (req > highest) highest = req;
        }
      }
      repCache[faction.name] = highest;
    } catch {
      repCache[faction.name] = 0;
    }
  }
}

function findNextRoadmapFaction(p: Player, factionReps: Record<string, number>): FactionConfig | null {
  const currentCityFaction = p.factions.find(f => CITY_FACTIONS.includes(f as FactionName));

  for (const faction of HACKING_FACTIONS) {
    if (CITY_FACTIONS.includes(faction.name)) {
      if (currentCityFaction && faction.name !== currentCityFaction) {
        continue;
      }
    }

    const repNeeded = repCache[faction.name] || 0;
    if (repNeeded > 0) {
      const currentRep = p.factions.includes(faction.name) ? (factionReps[faction.name] ?? 0) : 0;
      if (currentRep < repNeeded) return faction;
    }
  }
  return null;
}

function manageMicroservices(ns: NS, currentMode: string, hasSavingTarget: boolean, logger: Logger, targetStat?: number): void {
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

  if (currentMode === "MONEY" && (hasSavingTarget || !ns.isRunning("core/sys-batcher.js", "home"))) {
    targetScript = "tasks/crime.js";
  }

  // 1. Veraltete Microservices beenden
  for (const [_, script] of Object.entries(modeToScript)) {
    if (script !== targetScript && ns.isRunning(script, "home")) {
      ns.scriptKill(script, "home");
      logger.info(`⏹️ Veralteten Microservice beendet: ${script}`);
    }
  }

  // 2. Ziel-Microservice intelligent starten/überprüfen
  if (targetScript && ns.fileExists(targetScript, "home")) {
    const runningProc = ns.ps("home").find(p => p.filename === targetScript);
    const isRunning = runningProc !== undefined;
    let shouldStart = !isRunning;

    if (isRunning && currentMode === "TRAIN" && targetStat !== undefined) {
      const currentRunningTarget = runningProc?.args[0] as number | undefined;

      if (currentRunningTarget !== targetStat) {
        ns.scriptKill(targetScript, "home"); 
        shouldStart = true;                  
        logger.info(`🔄 Trainingsziel geändert (${currentRunningTarget} ➔ ${targetStat}). Starte Worker neu.`);
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
          logger.success(`▶️ Microservice gestartet: ${targetScript} für [${currentMode}] mit Args: ${args}`);
        } else {
          logger.error(`❌ Fehler beim Starten von ${targetScript} (PID war 0).`);
        }
      } else {
        logger.warn(`RAM-MANGEL! ${targetScript} benötigt ${requiredRam.toFixed(2)} GB.`);
      }
    }
  }
}

export function findBestFallbackTarget(
  ns: NS,
  hackingLevel: number,
  bnMults: any,
  allServers: string[],
  blacklistTarget: string | null = null,
): string {
  let bestTarget = "n00dles";
  let maxWeight = 0;

  const serverMaxMoneyMult = bnMults.ServerMaxMoney ?? 1.0;
  const growthMult = bnMults.ServerGrowthRate ?? 1.0;
  const isNoMoneyNode = serverMaxMoneyMult === 0;

  for (const current of allServers) {
    if (current === "home" || !ns.hasRootAccess(current) || current === blacklistTarget) continue;

    const reqHacking = ns.getServerRequiredHackingLevel(current);
    if (reqHacking > hackingLevel) continue;

    if (isNoMoneyNode) {
      const cycleTime = ns.getWeakenTime(current);
      const weight = reqHacking / (Math.max(1, cycleTime) / 1000);
      if (weight > maxWeight) {
        maxWeight = weight;
        bestTarget = current;
      }
      continue;
    }

    const serverMaxMoney = ns.getServerMaxMoney(current);
    if (serverMaxMoney <= 0) continue;

    const cycleTime = ns.getWeakenTime(current);
    if (cycleTime > 5 * 60 * 1000) continue;

    const weight = (serverMaxMoney / (cycleTime / 1000)) * (reqHacking / 100) * growthMult;

    if (weight > maxWeight) {
      maxWeight = weight;
      bestTarget = current;
    }
  }
  return bestTarget;
}

function applyToAllMegacorps(ns: NS, p: Player, logger: Logger): void {
  for (const corpName of Object.values(MEGACORPS)) {
    if (!p.jobs[corpName]) {
      if (ns.singularity.applyToCompany(corpName, "Software")) {
        logger.success(`💼 Bewerbung erfolgreich: Anstellung bei '${corpName}' erhalten.`);
      }
    }
  }
}

function dispatchSimpleTask(
  ns: NS,
  servers: string[],
  script: string,
  target: string,
  threads: number,
  bnMults: any,
): void {
  let threadsRemaining = threads;

  for (const server of servers) {
    if (!ns.hasRootAccess(server)) continue;
    if (ns.isRunning(script, server, target)) continue;

    const homeBuffer = bnMults.ServerWeakenRate < 1.0 ? Math.ceil(48 / bnMults.ServerWeakenRate) : 48;
    const maxRam = server === "home" ? ns.getServerMaxRam("home") - homeBuffer : ns.getServerMaxRam(server);
    const freeRam = maxRam - ns.getServerUsedRam(server);
    const scriptRam = ns.getScriptRam(script);

    const possibleThreads = Math.floor(freeRam / scriptRam);

    if (possibleThreads > 0) {
      const threadsToRun = Math.min(possibleThreads, threadsRemaining);
      ns.exec(script, server, threadsToRun, target);

      if (threadsRemaining !== Infinity) {
        threadsRemaining -= threadsToRun;
        if (threadsRemaining <= 0) break;
      }
    }
  }
}