import { NS, Player, FactionName, CompanyName } from "@ns";
import { loadState, saveState, BotStrategy } from "./state-manager.js";
import { breakAndInfectNetwork, getAllServers } from "../lib/network.js";
import { loadBnMults, DEFAULT_MULTIPLIERS } from "../lib/state.js";
import { Logger } from "./logger.js"; // 🌟 Logger importiert

interface FactionConfig {
  name: FactionName;
  minStat: number;
  priority: number;
}

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
  { name: "CyberSec" as FactionName, minStat: 0, priority: 1 },
  { name: "Tian Di Hui" as FactionName, minStat: 0, priority: 2 },
  { name: "Netburners" as FactionName, minStat: 0, priority: 3 },
  { name: "NiteSec" as FactionName, minStat: 0, priority: 4 },
  { name: "Slum Snakes" as FactionName, minStat: 30, priority: 5 },
  { name: "Sector-12" as FactionName, minStat: 0, priority: 6 },
  { name: "Chongqing" as FactionName, minStat: 0, priority: 7 },
  { name: "Ishima" as FactionName, minStat: 0, priority: 8 },
  { name: "New Tokyo" as FactionName, minStat: 0, priority: 9 },
  { name: "Tetrads" as FactionName, minStat: 75, priority: 10 },
  { name: "The Black Hand" as FactionName, minStat: 0, priority: 11 },
  { name: "Aevum" as FactionName, minStat: 0, priority: 13 },
  { name: "Volhaven" as FactionName, minStat: 0, priority: 13 },
  { name: "The Syndicate" as FactionName, minStat: 200, priority: 14 },
  { name: "BitRunners" as FactionName, minStat: 0, priority: 15 },
  { name: "ECorp" as FactionName, minStat: 0, priority: 16 },
  { name: "MegaCorp" as FactionName, minStat: 0, priority: 17 },
  { name: "KuaiGong International" as FactionName, minStat: 0, priority: 18 },
  { name: "Four Sigma" as FactionName, minStat: 0, priority: 19 },
  { name: "NWO" as FactionName, minStat: 0, priority: 20 },
  { name: "Blade Industries" as FactionName, minStat: 0, priority: 21 },
  { name: "OmniTek Incorporated" as FactionName, minStat: 0, priority: 22 },
  { name: "Bachman & Associates" as FactionName, minStat: 0, priority: 23 },
  { name: "Clarke Incorporated" as FactionName, minStat: 0, priority: 24 },
  {
    name: "Fulcrum Secret Technologies" as FactionName,
    minStat: 0,
    priority: 25,
  },
  { name: "Silhouette" as FactionName, minStat: 0, priority: 26 },
  { name: "The Dark Army" as FactionName, minStat: 300, priority: 27 },
  { name: "Speakers for the Dead" as FactionName, minStat: 300, priority: 28 },
  { name: "The Covenant" as FactionName, minStat: 850, priority: 29 },
  { name: "Illuminati" as FactionName, minStat: 1200, priority: 30 },
  { name: "Daedalus" as FactionName, minStat: 1500, priority: 31 },
];
const repCache: Record<string, number> = {};

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  // 🌟 Logger für das Core-Subsystem initialisieren
  const logger = new Logger(ns, "Dispatcher", "INFO");

  const getFreeRam = () =>
    ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
  const hasSingularity = ns.singularity !== undefined;

  if (!hasSingularity) {
    logger.error("Kritischer Systemfehler: Singularity-API (SF4) fehlt!");
    ns.tprint(
      "🛑 [Dispatcher] Kritischer Fehler: Singularity-API (SF4) fehlt!",
    );
    return;
  }

  logger.info(
    "Initialisiere Netzwerk-Multiplikatoren und Reputations-Cache...",
  );
  const bnMults = loadBnMults(ns) || DEFAULT_MULTIPLIERS;

  buildReputationCache(ns);

  const BATCHER_MIN_RAM = 256;
  const BATCHER_MIN_PSERV_RAM = 64;

  let lastValue = 0;
  let lastTime = Date.now();
  let emaRate = 0;
  let lastMode = "";

  let cachedFallbackTarget = "n00dles";
  let lastFallbackUpdate = 0;
  let lastCacheRefresh = Date.now();

  let modeLockTime = Date.now();
  const STRATEGY_COOLDOWN = 60_000;

  let lastCorpApplication = 0;

  while (true) {
    if (Date.now() - lastCacheRefresh > 900_000) {
      buildReputationCache(ns);
      lastCacheRefresh = Date.now();
      logger.info("Reputations-Cache routinemäßig aktualisiert.");
    }

    breakAndInfectNetwork(ns);

    const currentState = loadState(ns);
    let mode: BotStrategy = "MONEY";
    const p = ns.getPlayer();
    const homeMaxRam = ns.getServerMaxRam("home");

    if (p.skills.hacking >= 250 && Date.now() - lastCorpApplication > 600_000) {
      applyToAllMegacorps(ns, p, logger); // 🌟 Logger übergeben
      lastCorpApplication = Date.now();
    }

    // --- 0. INFRASTRUKTUR VORABBERECHNUNG ---
    const pServers = ns.cloud.getServerNames();
    const eligiblePServers = pServers.filter(
      (s) => ns.getServerMaxRam(s) >= BATCHER_MIN_PSERV_RAM,
    );

    const hasFormulas = ns.fileExists("Formulas.exe", "home");
    const canRunBatcher =
      hasFormulas &&
      homeMaxRam >= BATCHER_MIN_RAM &&
      eligiblePServers.length > 0;

    // --- 1. DYNAMISCHE STRATEGIE-MATRIX (MIT HYSTERESE-PUFFER) ---
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
    const factionToWorkFor =
      eligiblePServers.length > 0 && factionRepMult > 0.1
        ? findNextRoadmapFaction(ns, p)
        : null;

    let targetFaction: FactionName | null = null;
    let targetCompany: CompanyName | undefined = undefined;
    let targetStat = 0;

    // --- 1. DYNAMISCHE STRATEGIE-MATRIX ---
    // --- STRATEGIE-EVALUIERUNG ---
    const isRushActive =
      hasFormulas && homeMaxRam >= 256 && eligiblePServers.length === 0;

    // 1. Hole das komplette Konfigurations-Objekt
    const nextRoadmapFaction = findNextRoadmapFaction(ns, p);

    // 2. Extrahierte String-Variablen für die Zuweisung vorbereiten
    const roadmapFactionName = nextRoadmapFaction
      ? (nextRoadmapFaction.name as FactionName)
      : null;

    // 3. Zuweisung an die bestehenden System-Variablen (Typkonform als String!)
    targetFaction =
      roadmapFactionName && p.factions.includes(roadmapFactionName)
        ? roadmapFactionName
        : null;
    targetCompany = undefined;
    targetStat = 0;

    // --- 1. DYNAMISCHE STRATEGIE-MATRIX ---
    if (p.skills.hacking < 50) {
      mode = "XP_SPRINT";
    } else if (homeMaxRam < 256 || (crimeMoneyMult > 5 && !canRunBatcher)) {
      mode = "CRIME";
    } else if (isRushActive) {
      mode = "PSERV_RUSH";
    } else if (nextRoadmapFaction && roadmapFactionName) {
      // HIER nutzen wir das Objekt für Bedingungen...
      const isMember = p.factions.includes(roadmapFactionName);
      const karma = ns.heart.break();
      const isCombatFaction =
        nextRoadmapFaction.minStat > 0 ||
        [
          "Slum Snakes",
          "Tetrads",
          "The Syndicate",
          "The Dark Army",
          "Speakers for the Dead",
        ].includes(roadmapFactionName);

      if (!isMember) {
        // ...und weisen hier targetFaction den sauberen String zu!
        targetFaction = roadmapFactionName;

        if (roadmapFactionName === "Slum Snakes" && karma > -9) {
          mode = "CRIME";
        } else if (roadmapFactionName === "Tetrads" && karma > -18) {
          mode = "CRIME";
        } else if (roadmapFactionName === "The Syndicate" && karma > -90) {
          mode = "CRIME";
        } else if (
          roadmapFactionName === "The Dark Army" &&
          p.numPeopleKilled < 5
        ) {
          mode = "KILLS";
          targetStat = 5;
        } else if (
          roadmapFactionName === "Speakers for the Dead" &&
          p.numPeopleKilled < 30
        ) {
          mode = "KILLS";
          targetStat = 30;
        } else if (
          nextRoadmapFaction.minStat > 0 &&
          Math.min(...COMBAT_STATS.map((s) => p.skills[s])) <
            nextRoadmapFaction.minStat
        ) {
          mode = "TRAIN";
          targetStat = nextRoadmapFaction.minStat;
        } else {
          mode = "MONEY";
        }
      } else {
        if (isReadyForFactionGrind || isCombatFaction) {
          mode = "REP";
          targetFaction = roadmapFactionName;
          targetStat = nextRoadmapFaction.minStat;
        } else {
          mode = "MONEY";
        }
      }
    } else {
      // --- ENDGAME / NO MORE ROADMAP FACTIONS ---
      if (p.skills.hacking >= 250 && companyRepMult > 0.1) {
        const needsSilhouette =
          !p.factions.includes("Silhouette" as FactionName) &&
          (repCache["Silhouette"] ?? 0) > 0;

        const isExecutive = Object.values(p.jobs).some((title) =>
          [
            "Chief Technology Officer",
            "Chief Financial Officer",
            "Chief Executive Officer",
          ].includes(title),
        );

        const hasEnoughKarma = ns.heart.break() <= -22;

        if (needsSilhouette && (!isExecutive || !hasEnoughKarma)) {
          if (!hasEnoughKarma) {
            mode = "CRIME";
          } else {
            mode = "CORP";
            const currentCorpJob = Object.keys(p.jobs).find(
              (corp) => MEGACORPS[corp] !== undefined,
            );
            targetCompany = currentCorpJob
              ? (MEGACORPS[currentCorpJob] as CompanyName)
              : (Object.values(MEGACORPS)[0] as CompanyName);
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
            targetCompany = MEGACORPS[missingCorpFaction.name] as CompanyName;
          }
        }
      }

      if (mode === "MONEY") {
        if (eligiblePServers.length === 0) {
          mode = "MONEY";
        } else {
          const FOCUS_ON_COMBAT_FACTIONS = false;

          if (FOCUS_ON_COMBAT_FACTIONS) {
            const nextLockedCombatFaction = HACKING_FACTIONS.find(
              (f) => !p.factions.includes(f.name) && f.minStat > 0,
            );

            if (nextLockedCombatFaction) {
              let requiredKills = 0;
              if (nextLockedCombatFaction.name === "The Dark Army")
                requiredKills = 5;
              if (nextLockedCombatFaction.name === "Speakers for the Dead")
                requiredKills = 30;

              const currentLowestCombatStat = Math.min(
                ...COMBAT_STATS.map((s) => p.skills[s]),
              );

              if (p.numPeopleKilled < requiredKills) {
                mode = "KILLS";
                targetStat = requiredKills;
                targetFaction = nextLockedCombatFaction.name;
              } else if (
                currentLowestCombatStat < nextLockedCombatFaction.minStat
              ) {
                mode = "TRAIN";
                targetStat = nextLockedCombatFaction.minStat;
                targetFaction = nextLockedCombatFaction.name;
              }
            }
          } else {
            mode = "MONEY";
          }
        }
      }
    }

    if (Date.now() - lastFallbackUpdate > 300_000 || mode === "MONEY") {
      cachedFallbackTarget = findBestFallbackTarget(
        ns,
        p.skills.hacking,
        bnMults,
        canRunBatcher ? currentState?.batcherTarget : null,
      );
      lastFallbackUpdate = Date.now();
    }

    // --- COOLDOWN ENGINE (SCHONFRIST) ---
    const previousStrategy = currentState?.strategy || "MONEY";
    const now = Date.now();

    if (mode !== previousStrategy) {
      // Im COOLDOWN ENGINE Block:
      const isOscillating =
        ["MONEY", "CRIME", "REP", "CORP", "TRAIN", "PSERV_RUSH"].includes(
          mode,
        ) &&
        ["MONEY", "CRIME", "REP", "CORP", "TRAIN", "PSERV_RUSH"].includes(
          previousStrategy,
        );

      if (isOscillating && now - modeLockTime < STRATEGY_COOLDOWN) {
        // Halt stop! Die Schonfrist läuft noch. Strategiewechsel blockieren.
        mode = previousStrategy as BotStrategy;

        // Da wir die alte Strategie erzwingen, müssen wir auch die Ziel-Variablen restaurieren
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
      currentVal = ns.singularity.getFactionRep(targetFaction);
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

    // 🌟 STRATEGIE-WECHSEL PROTOKOLLIEREN
    if (mode !== lastMode) {
      logger.info(
        `🔄 Strategiewechsel initiiert: ${lastMode || "START"} ➔ ${mode} ${label ? `(${label})` : ""}`,
      );
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
          emaRate =
            emaRate === 0 ? instantRate : emaRate * 0.7 + instantRate * 0.3;
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
      generatedBar =
        crimeMoneyMult > 5
          ? "🥷 BN-Synergie: Dauerhafter Crime Loop aktiv (Mörderischer Profit)"
          : "🥷 Mid-Game-Crime Loop für stabiles Einkommen";
    } else if (mode === "PSERV_RUSH") {
      const pservCost = ns.cloud.getServerCost(64);
      const rushProgress = ((playerMoney / pservCost) * 100).toFixed(1);
      generatedBar = `🚀 BATCHER RUSH active | Cash: ${ns.format.number(playerMoney, 1)} / ${ns.format.number(pservCost, 0)} $ (${rushProgress}%) | Warte auf ersten 64GB Server`;
    } else if (mode === "KILLS") {
      generatedBar = `💀 Eliminierungs-Aufträge active (${currentVal}/${targetVal} Kills)`;
    } else if (mode === "MONEY" && !canRunBatcher) {
      generatedBar = `🏗️ Aufbau-Phase: Generiere Basis-Geld auf ${cachedFallbackTarget} (Warte auf P-Server)`;
    } else {
      if (factionToWorkFor) {
        const progressPct = ((playerMoney / effectiveThreshold) * 100).toFixed(
          1,
        );
        generatedBar = `💰 Spare für ${factionToWorkFor}: ${ns.format.number(playerMoney, 1)} / ${ns.format.number(effectiveThreshold, 0)} $ (${progressPct}%)`;
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
      logger.info(
        "Batcher nicht ausführbar. 'fill-ram.js' vorsorglich beendet.",
      );
    }

    saveState(ns, {
      ...currentState,
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

    // --- 4. STRATEGIE-AWARE WORKER ALLOKATION ---
    const allNetworkServers: string[] = getAllServers(ns);
    const activeStrategy = currentState?.strategy || "MONEY";

    const workerScript =
      activeStrategy === "XP_SPRINT" ? "tasks/xp-grind.js" : "tasks/work.js";
    const obsoleteScript =
      activeStrategy === "XP_SPRINT" ? "tasks/work.js" : "tasks/xp-grind.js";

    const infectedServers = allNetworkServers.filter(
      (s: string) =>
        s !== "home" &&
        !pServers.includes(s) &&
        ns.hasRootAccess(s) &&
        ns.getServerMaxRam(s) > 0,
    );
    const workerFleet = [...infectedServers];

    if (canRunBatcher) {
      if (
        !ns.scriptRunning("core/sys-batcher.js", "home") &&
        getFreeRam() > 15
      ) {
        ns.run("core/sys-batcher.js", 1);
        logger.success(
          "🔥 System-Voraussetzungen erfüllt: 'sys-batcher.js' gestartet.",
        );
      }
      for (const server of pServers) {
        ns.scriptKill(workerScript, server);
        ns.scriptKill(obsoleteScript, server);
      }
    } else {
      workerFleet.push(...pServers);
    }

    for (const server of workerFleet) {
      if (ns.scriptRunning(obsoleteScript, server))
        ns.scriptKill(obsoleteScript, server);

      const runningProc = ns
        .ps(server)
        .find((proc) => proc.filename === workerScript);
      if (runningProc && runningProc.args[0] !== cachedFallbackTarget) {
        ns.scriptKill(workerScript, server);
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

    const homeShouldRunWorker =
      !["REP", "TRAIN", "CORP", "CRIME"].includes(activeStrategy) &&
      !canRunBatcher;
    if (!homeShouldRunWorker) {
      ns.scriptKill(workerScript, "home");
    } else {
      const homeProc = ns
        .ps("home")
        .find((proc) => proc.filename === workerScript);
      if (homeProc && homeProc.args[0] !== cachedFallbackTarget)
        ns.scriptKill(workerScript, "home");

      const homeFreeRam = getFreeRam();
      const reservedRam =
        bnMults.ServerWeakenRate < 1.0
          ? Math.ceil(20 / bnMults.ServerWeakenRate)
          : 20;
      const workerRam = ns.getScriptRam(workerScript);

      if (homeFreeRam > reservedRam + workerRam) {
        const homeThreads = Math.floor((homeFreeRam - reservedRam) / workerRam);
        if (homeThreads > 0 && !ns.scriptRunning(workerScript, "home")) {
          ns.run(workerScript, homeThreads, cachedFallbackTarget);
        }
      }
    }

    const isRamReady =
      homeMaxRam >= 256 ||
      (pServers.length > 0 &&
        Math.max(...pServers.map((s) => ns.getServerMaxRam(s))) >= 64);
    const executionAllowed =
      !hasFormulas || ns.isRunning("core/sys-batcher.js", "home");

    if (
      isRamReady &&
      !isEarlyGameCrime &&
      executionAllowed &&
      !ns.isRunning("utils/fill-ram.js", "home") &&
      getFreeRam() > 15
    ) {
      ns.run("utils/fill-ram.js", 1);
    }

    // --- ÜBERGABE AN MICROSERVICES ---
    manageMicroservices(ns, mode, factionToWorkFor !== null, logger); // 🌟 Logger übergeben

    // 🛑 STICKY-ACTION-STOPP:
    if (mode === "MONEY" && !factionToWorkFor && canRunBatcher) {
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

function findNextRoadmapFaction(ns: NS, p: Player): FactionConfig | null {
  for (const faction of HACKING_FACTIONS) {
    const repNeeded = repCache[faction.name] || 0;
    if (repNeeded > 0) {
      const currentRep = p.factions.includes(faction.name)
        ? ns.singularity.getFactionRep(faction.name)
        : 0;
      if (currentRep < repNeeded) {
        return faction; // Gibt das komplette Objekt zurück (Zeile 658 Fix)
      }
    }
  }
  return null;
}

function manageMicroservices(
  ns: NS,
  currentMode: string,
  hasSavingTarget: boolean,
  logger: Logger, // 🌟 Parameter hinzugefügt
): void {
  const modeToScript: Record<string, string> = {
    REP: "tasks/faction-grind.js",
    CORP: "tasks/corp.js",
    TRAIN: "tasks/train.js",
    CRIME: "tasks/crime.js",
    XP_SPRINT: "tasks/crime.js",
    KILLS: "tasks/crime.js",
    PSERV_RUSH: "tasks/crime.js", // 🚀 Nutzt kostenlose Kriminalität für schnelles Cash
  };

  let targetScript = modeToScript[currentMode];

  if (currentMode === "MONEY" && hasSavingTarget) {
    targetScript = "tasks/crime.js";
  }

  for (const [mode, script] of Object.entries(modeToScript)) {
    if (script !== targetScript && ns.isRunning(script, "home")) {
      ns.scriptKill(script, "home");
      logger.info(`⏹️ Veralteten Microservice beendet: ${script}`);
    }
  }

  if (
    targetScript &&
    !ns.isRunning(targetScript, "home") &&
    ns.fileExists(targetScript, "home")
  ) {
    const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
    const requiredRam = ns.getScriptRam(targetScript, "home");

    if (freeRam >= requiredRam) {
      ns.run(targetScript, 1);
      logger.success(
        `▶️ Neuen Microservice gestartet: ${targetScript} für Modus [${currentMode}]`,
      );
    } else {
      logger.warn(
        `RAM-MANGEL! ${targetScript} benötigt ${requiredRam.toFixed(2)} GB.`,
      );
    }
  }
}

export function findBestFallbackTarget(
  ns: NS,
  hackingLevel: number,
  bnMults: any,
  blacklistTarget: string | null = null,
): string {
  let bestTarget = "n00dles";
  let maxWeight = 0;

  const serverMaxMoneyMult = bnMults.ServerMaxMoney ?? 1.0;
  const growthMult = bnMults.ServerGrowthRate ?? 1.0;
  const isNoMoneyNode = serverMaxMoneyMult === 0;

  const visited = new Set<string>();
  const queue = ["home"];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = ns.scan(current);
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }

    if (
      current === "home" ||
      !ns.hasRootAccess(current) ||
      current === blacklistTarget
    )
      continue;

    const serverMaxMoney = ns.getServerMaxMoney(current);
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

    if (serverMaxMoney <= 0) continue;

    const cycleTime = ns.getWeakenTime(current);
    if (cycleTime > 5 * 60 * 1000) continue;

    const weight =
      (serverMaxMoney / (cycleTime / 1000)) * (reqHacking / 100) * growthMult;

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
        logger.success(
          `💼 Bewerbung erfolgreich: Anstellung bei '${corpName}' erhalten.`,
        );
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

    const homeBuffer =
      bnMults.ServerWeakenRate < 1.0
        ? Math.ceil(48 / bnMults.ServerWeakenRate)
        : 48;
    const maxRam =
      server === "home"
        ? ns.getServerMaxRam("home") - homeBuffer
        : ns.getServerMaxRam(server);
    const freeRam = maxRam - ns.getServerUsedRam(server);
    const scriptRam = ns.getScriptRam(script);

    const possibleThreads = Math.floor(freeRam / scriptRam);

    if (possibleThreads > 0) {
      const threadsToRun = Math.min(possibleThreads, threadsRemaining);
      ns.exec(script, server, threadsToRun, target);

      threadsRemaining -= threadsToRun;
      if (threadsRemaining <= 0) break;
    }
  }
}
