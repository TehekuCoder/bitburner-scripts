import { NS, Player, FactionName, CompanyName } from "@ns";
import {
  loadState,
  saveState,
  BotState,
  BotStrategy,
  patchState,
} from "./state-manager.js";
// 🔥 OPTIMIERUNG: getAllServers aus deiner Netzwerk-Library importieren
import { breakAndInfectNetwork, getAllServers } from "../lib/network.js";

interface FactionConfig {
  name: FactionName;
  minStat: number;
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
  { name: "CyberSec" as FactionName, minStat: 0 },
  { name: "Silhouette" as FactionName, minStat: 0 },
  { name: "Tian Di Hui" as FactionName, minStat: 0 },
  { name: "Netburners" as FactionName, minStat: 0 },
  { name: "NiteSec" as FactionName, minStat: 0 },
  { name: "The Black Hand" as FactionName, minStat: 0 },
  { name: "BitRunners" as FactionName, minStat: 0 },
  { name: "Sector-12" as FactionName, minStat: 0 },
  { name: "Aevum" as FactionName, minStat: 0 },
  { name: "Volhaven" as FactionName, minStat: 0 },
  { name: "Chongqing" as FactionName, minStat: 0 },
  { name: "New Tokyo" as FactionName, minStat: 0 },
  { name: "Ishima" as FactionName, minStat: 0 },
  { name: "Slum Snakes" as FactionName, minStat: 30 },
  { name: "Tetrads" as FactionName, minStat: 75 },
  { name: "The Syndicate" as FactionName, minStat: 200 },
  { name: "The Dark Army" as FactionName, minStat: 300 },
  { name: "Speakers for the Dead" as FactionName, minStat: 300 },
  { name: "The Covenant" as FactionName, minStat: 850 },
  { name: "Illuminati" as FactionName, minStat: 1200 },
  { name: "Daedalus" as FactionName, minStat: 1500 },
];

const repCache: Record<string, number> = {};

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const getFreeRam = () =>
    ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
  const hasSingularity = ns.singularity !== undefined;

  if (!hasSingularity) {
    ns.tprint(
      "🛑 [Dispatcher] Kritischer Fehler: Singularity-API (SF4) fehlt!",
    );
    return;
  }

  ns.print("⚙️ [Dispatcher] Initialisiere Augmentations-Cache...");

  const BATCHER_MIN_RAM = 256;
  const BATCHER_MIN_PSERV_RAM = 64;

  let lastValue = 0;
  let lastTime = Date.now();
  let emaRate = 0;
  let lastMode = "";

  let cachedFallbackTarget = "n00dles";
  let lastFallbackUpdate = 0;

  while (true) {
    buildReputationCache(ns);
    breakAndInfectNetwork(ns);

    let mode: BotStrategy = "MONEY";
    const p = ns.getPlayer();
    const homeMaxRam = ns.getServerMaxRam("home");

    let targetFaction: FactionName | null = null;
    let targetCompany: CompanyName | undefined = undefined;
    let targetStat = 0;

    if (p.skills.hacking >= 250) {
      applyToAllMegacorps(ns, p);
    }

    // --- 0. INFRASTRUKTUR VORABBERECHNUNG ---
    const pServers = ns.cloud.getServerNames();
    const eligiblePServers = pServers.filter(
      (s) => ns.getServerMaxRam(s) >= BATCHER_MIN_PSERV_RAM,
    );
    const maxPservRam =
      pServers.length > 0
        ? Math.max(...pServers.map((s: string) => ns.getServerMaxRam(s)))
        : 0;

    const hasFormulas = ns.fileExists("Formulas.exe", "home");
    const canRunBatcher =
      hasFormulas &&
      homeMaxRam >= BATCHER_MIN_RAM &&
      eligiblePServers.length > 0;

    // --- 1. STRATEGIE-MATRIX ---
    const playerMoney = p.money;
    const MONEY_THRESHOLD_FOR_REP = 10_000_000;

    const hasEssentialTools =
      ns.fileExists("BruteSSH.exe", "home") &&
      ns.fileExists("FTPCrack.exe", "home");

    const isReadyForFactionGrind = playerMoney > MONEY_THRESHOLD_FOR_REP;

    const factionToWorkFor =
      (hasEssentialTools || isReadyForFactionGrind) &&
      eligiblePServers.length > 0
        ? findNextFaction(ns, p)
        : null;

    if (p.skills.hacking < 50) {
      mode = "XP_SPRINT";
    } else if (homeMaxRam < 256) {
      mode = "CRIME";
    } else if (factionToWorkFor) {
      mode = "REP";
      targetFaction = factionToWorkFor;
    } else {
      if (p.skills.hacking >= 250) {
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
        const hasEnoughMoney = p.money >= 15_000_000;

        if (needsSilhouette && (!isExecutive || !hasEnoughKarma)) {
          if (!hasEnoughKarma) {
            mode = "CRIME";
          } else {
            mode = "CORP";
            targetCompany = Object.values(MEGACORPS)[0];
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
          }
        }
      }

      if (mode === "MONEY") {
        if (eligiblePServers.length === 0) {
          mode = "MONEY";
        } else {
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
        }

        if (Date.now() - lastFallbackUpdate > 300_000 || mode === "MONEY") {
          cachedFallbackTarget = findBestFallbackTarget(ns, p.skills.hacking);
          lastFallbackUpdate = Date.now();
        }
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

    const now = Date.now();
    if (mode !== lastMode) {
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

    // --- 3. UI DASHBOARD UPDATE & FILLER CONFIG ANPASSUNG ---
    let generatedBar = "";
    if (["REP", "CORP", "TRAIN"].includes(mode) && targetVal > 0) {
      const pct = ((currentVal / targetVal) * 100).toFixed(1);
      generatedBar = `${label} | ${ns.format.number(currentVal, 1)}/${ns.format.number(targetVal, 1)} (${pct}%) | ETA: ${etaStr}`;
    } else if (targetVal === 0 && mode === "REP" && targetFaction) {
      generatedBar = `🥷 ${targetFaction} | Karma/Gang Grind aktiv`;
    } else if (mode === "XP_SPRINT") {
      generatedBar = "👶 Early Game: XP SPRINT (Hacking < 50)";
    } else if (mode === "CRIME") {
      generatedBar = "🥷 Mid-Game-Crime Loop für stabiles Einkommen";
    } else if (mode === "KILLS") {
      generatedBar = `💀 Eliminierungs-Aufträge aktiv (${currentVal}/${targetVal} Kills)`;
    } else if (mode === "MONEY" && !canRunBatcher) {
      const fallbackTarget = findBestFallbackTarget(ns, p.skills.hacking);
      generatedBar = `🏗️ Aufbau-Phase: Generiere Basis-Geld auf ${fallbackTarget} (Warte auf P-Server)`;
    } else {
      generatedBar = "💰 Maximiere Profit (Batcher)";
    }

    const currentState = loadState(ns);
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
      dynamicMaxXp = p.skills.hacking;
    } else if (p.skills.hacking > 800) {
      dynamicMaxXp = 1500;
    }

    if (!canRunBatcher && ns.isRunning("utils/fill-ram.js", "home")) {
      ns.scriptKill("utils/fill-ram.js", "home");
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
      if (ns.isRunning("tasks/faction-shopping.js", "home")) {
        ns.scriptKill("tasks/faction-shopping.js", "home");
      }
      const rogueScripts = ["tasks/hacknet.js", "tasks/hacknet-early.js"];
      for (const script of rogueScripts) {
        if (ns.fileExists(script, "home") && ns.isRunning(script, "home")) {
          ns.scriptKill(script, "home");
        }
      }
    } else {
      if (
        getFreeRam() > 12 &&
        !ns.isRunning("tasks/faction-shopping.js", "home")
      ) {
        ns.run("tasks/faction-shopping.js", 1);
      }
    }

    // ====================================================================================
    // --- 4. STRATEGIE-AWARE WORKER ALLOKATION (GEWALTENTRENNUNG) ---
    // ====================================================================================
    const allNetworkServers: string[] = getAllServers(ns);

    const activeStrategy = currentState?.strategy || "MONEY";
    const batcherTarget = currentState?.batcherTarget || null; // 🎯 Liest das geschützte Batcher-Ziel

    // Dynamische Skript-Weiche für XP_SPRINT
    const workerScript =
      activeStrategy === "XP_SPRINT" ? "tasks/xp-grind.js" : "tasks/work.js";
    const obsoleteScript =
      activeStrategy === "XP_SPRINT" ? "tasks/work.js" : "tasks/xp-grind.js";

    const workerRam = ns.getScriptRam(workerScript, "home");

    // 🔥 Berechnet das optimale Ziel für die Flotte und ignoriert dabei das Batcher-Ziel
    const fallbackTarget = findBestFallbackTarget(
      ns,
      p.skills.hacking,
      batcherTarget,
    );

    // --------------------------------------------------------------------------------
    // KLASSE A: Die Grinding-Zwerge (Gehackte Server, die NICHT dir gehören)
    // --------------------------------------------------------------------------------
    const infectedServers = allNetworkServers.filter(
      (s: string) =>
        s !== "home" &&
        !pServers.includes(s) &&
        ns.hasRootAccess(s) &&
        ns.getServerMaxRam(s) > 0,
    );

    for (const server of infectedServers) {
      if (ns.isRunning(obsoleteScript, server))
        ns.scriptKill(obsoleteScript, server);

      ns.scp(workerScript, server, "home");
      const processes = ns.ps(server);
      const runningWorker = processes.find(
        (proc) => proc.filename === workerScript,
      );

      const maxRam = ns.getServerMaxRam(server);
      const maxPossibleThreads = Math.floor(maxRam / workerRam);

      if (maxPossibleThreads === 0) continue;

      if (runningWorker) {
        if (
          runningWorker.args[0] !== fallbackTarget ||
          runningWorker.threads < maxPossibleThreads
        ) {
          ns.scriptKill(workerScript, server);
        } else {
          continue;
        }
      }

      const usedRam = ns.getServerUsedRam(server);
      const freeRam = maxRam - usedRam;
      const threads = Math.floor(freeRam / workerRam);

      if (threads > 0) {
        ns.exec(workerScript, server, threads, fallbackTarget);
      }
    }

    // --------------------------------------------------------------------------------
    // KLASSE B: Die Heavy-Lifter (Home & Gekaufte Server)
    // --------------------------------------------------------------------------------
    if (ns.isRunning(obsoleteScript, "home"))
      ns.scriptKill(obsoleteScript, "home");
    for (const server of pServers) {
      if (ns.isRunning(obsoleteScript, server))
        ns.scriptKill(obsoleteScript, server);
    }

    if (canRunBatcher) {
      if (ns.isRunning(workerScript, "home"))
        ns.scriptKill(workerScript, "home");
      for (const server of pServers) {
        if (ns.isRunning(workerScript, server))
          ns.scriptKill(workerScript, server);
      }

      if (!ns.isRunning("core/sys-batcher.js", "home")) {
        if (ns.isRunning("utils/fill-ram.js", "home")) {
          ns.scriptKill("utils/fill-ram.js", "home");
        }
        if (getFreeRam() > 15) {
          ns.run("core/sys-batcher.js", 1);
        }
      }
    } else {
      if (ns.isRunning("core/sys-batcher.js", "home")) {
        ns.scriptKill("core/sys-batcher.js", "home");
      }

      for (const server of pServers) {
        ns.scp(workerScript, server, "home");
        const processes = ns.ps(server);
        const runningWorker = processes.find(
          (proc) => proc.filename === workerScript,
        );

        const maxRam = ns.getServerMaxRam(server);
        const maxPossibleThreads = Math.floor(maxRam / workerRam);

        if (maxPossibleThreads === 0) continue;

        if (runningWorker) {
          if (
            runningWorker.args[0] !== fallbackTarget ||
            runningWorker.threads < maxPossibleThreads
          ) {
            ns.scriptKill(workerScript, server);
          } else {
            continue;
          }
        }

        const usedRam = ns.getServerUsedRam(server);
        const freeRam = maxRam - usedRam;
        const threads = Math.floor(freeRam / workerRam);

        if (threads > 0) {
          ns.exec(workerScript, server, threads, fallbackTarget);
        }
      }

      const homeShouldRunWorker = !["REP", "TRAIN", "CORP", "CRIME"].includes(
        activeStrategy,
      );

      if (!homeShouldRunWorker) {
        if (ns.isRunning(workerScript, "home")) {
          ns.print(
            `🛑 [Dispatcher] Strategie ${activeStrategy} aktiv. Rufe Worker von 'home' zurück!`,
          );
          ns.scriptKill(workerScript, "home");
        }
      } else {
        const homeProcesses = ns.ps("home");
        const runningWorkerOnHome = homeProcesses.find(
          (proc) => proc.filename === workerScript,
        );

        if (
          runningWorkerOnHome &&
          runningWorkerOnHome.args[0] !== fallbackTarget
        ) {
          ns.scriptKill(workerScript, "home");
        }

        const isWorkerRunningOnHome = homeProcesses.some(
          (proc) =>
            proc.filename === workerScript && proc.args[0] === fallbackTarget,
        );

        if (!isWorkerRunningOnHome) {
          const homeFreeRam = getFreeRam();
          const reservedRam = 20;
          if (homeFreeRam > reservedRam + workerRam) {
            const homeThreads = Math.floor(
              (homeFreeRam - reservedRam) / workerRam,
            );
            if (homeThreads > 0) {
              ns.run(workerScript, homeThreads, fallbackTarget);
            }
          }
        }
      }
    }
    const isRamReady = homeMaxRam >= 256 || maxPservRam >= 64;
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

    manageMicroservices(ns, mode);
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

function findNextFaction(ns: NS, p: Player): FactionName | null {
  const activeFactionJobs = HACKING_FACTIONS.filter((f) =>
    p.factions.includes(f.name),
  )
    .map((f) => {
      const repNeeded = repCache[f.name] || 0;
      const currentRep = ns.singularity.getFactionRep(f.name);
      return { name: f.name, missingRep: repNeeded - currentRep };
    })
    .filter((f) => f.missingRep > 0)
    .sort((a, b) => a.missingRep - b.missingRep);

  return activeFactionJobs.length > 0 ? activeFactionJobs[0].name : null;
}

function manageMicroservices(ns: NS, currentMode: string): void {
  const modeToScript: Record<string, string> = {
    REP: "tasks/faction-grind.js",
    CORP: "tasks/corp.js",
    TRAIN: "tasks/train.js",
    CRIME: "tasks/crime.js",
    XP_SPRINT: "tasks/crime.js",
    KILLS: "tasks/crime.js",
  };

  const targetScript = modeToScript[currentMode];

  for (const [mode, script] of Object.entries(modeToScript)) {
    if (script !== targetScript && ns.isRunning(script, "home")) {
      ns.scriptKill(script, "home");
    }
  }

  if (
    targetScript &&
    !ns.isRunning(targetScript, "home") &&
    ns.fileExists(targetScript, "home")
  ) {
    const maxRam = ns.getServerMaxRam("home");
    const usedRam = ns.getServerUsedRam("home");
    const freeRam = maxRam - usedRam;
    const requiredRam = ns.getScriptRam(targetScript, "home");

    if (freeRam >= requiredRam) {
      const pid = ns.run(targetScript, 1);
      if (pid === 0) {
        ns.print(
          `🛑 [Dispatcher] Fehler beim Start von ${targetScript} (PID 0).`,
        );
      } else {
        ns.print(`🚀 [Dispatcher] ${targetScript} erfolgreich gestartet.`);
      }
    } else {
      ns.print(
        `⚠️ [Dispatcher] RAM-MANGEL! ${targetScript} benötigt ${requiredRam.toFixed(2)} GB. Frei: ${freeRam.toFixed(2)} GB.`,
      );
    }
  }
}

export function findBestFallbackTarget(
  ns: NS,
  hackingLevel: number,
  blacklistTarget: string | null = null,
): string {
  let bestTarget = "n00dles";
  let maxMoney = ns.getServerMaxMoney("n00dles");

  const visited = new Set<string>();
  const queue = ["home"];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    // Nachbarn scannen (muss VOR den continues passieren, damit das Netzwerk weiter aufgedeckt wird)
    const neighbors = ns.scan(current);
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }

    // Sicherheits-Guards
    if (current === "home" || !ns.hasRootAccess(current)) continue;

    // 🔥 NEU: Wenn dieser Server das aktuelle Batcher-Ziel ist, überspringen wir ihn für die Worker!
    if (current === blacklistTarget) continue;

    const serverMaxMoney = ns.getServerMaxMoney(current);
    const reqHacking = ns.getServerRequiredHackingLevel(current);

    // 🔥 FIX: 'currentHackingLevel' zu 'hackingLevel' korrigiert, passend zur Funktionssignatur
    if (serverMaxMoney > maxMoney && reqHacking <= hackingLevel) {
      bestTarget = current;
      maxMoney = serverMaxMoney;
    }
  }
  return bestTarget;
}

function applyToAllMegacorps(ns: NS, p: Player): void {
  for (const corpName of Object.values(MEGACORPS)) {
    if (!p.jobs[corpName]) {
      const success = ns.singularity.applyToCompany(corpName, "Software");
      if (success) {
        ns.print(
          `💼 [Auto-Career] Einstiegsjob bei ${corpName} erfolgreich angenommen.`,
        );
      }
    }
  }
}
