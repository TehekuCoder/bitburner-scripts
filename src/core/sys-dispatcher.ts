import { NS, Player, FactionName, CompanyName } from "@ns";
import {
  loadState,
  saveState,
  BotState,
  BotStrategy,
} from "./state-manager.js";
import { breakAndInfectNetwork } from "../lib/network.js";

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
  buildReputationCache(ns);

  let lastValue = 0;
  let lastTime = Date.now();
  let emaRate = 0;
  let lastMode = "";

  while (true) {
    breakAndInfectNetwork(ns);

    let mode: BotStrategy = "MONEY";
    const p = ns.getPlayer();
    const homeMaxRam = ns.getServerMaxRam("home");

    let targetFaction: FactionName | null = null;
    let targetCompany: CompanyName | undefined = undefined;
    let targetStat = 0;

    // --- 1. STRATEGIE-MATRIX (REORGANISIERT) ---
    const hasEssentialTools =
      ns.fileExists("BruteSSH.exe", "home") &&
      ns.fileExists("FTPCrack.exe", "home") &&
      ns.fileExists("relaySMTP.exe", "home");

    const factionToWorkFor = hasEssentialTools ? findNextFaction(ns, p) : null;

    if (p.skills.hacking < 50) {
      mode = "XP_SPRINT";
    }
    // 🔥 CRITICAL GATEKEEPER: Unter 128GB RAM hat Geld-Generierung via Crime absolute Priorität!
    else if (homeMaxRam < 128) {
      mode = "CRIME"; // Harmonisiert mit dem Kernel-String
    }
    // Erst AB 128GB RAM erlauben wir Fraktions- und Corporate-Grinds
    else if (factionToWorkFor) {
      mode = "REP";
      targetFaction = factionToWorkFor;
    } else {
      const nextLockedCombatFaction = HACKING_FACTIONS.find(
        (f) => !p.factions.includes(f.name) && f.minStat > 0,
      );

      if (nextLockedCombatFaction) {
        let requiredKills = 0;
        if (nextLockedCombatFaction.name === "The Dark Army") requiredKills = 5;
        if (nextLockedCombatFaction.name === "Speakers for the Dead")
          requiredKills = 30;

        const currentLowestCombatStat = Math.min(
          ...COMBAT_STATS.map((s) => p.skills[s]),
        );

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

      if (mode !== "TRAIN" && p.skills.hacking >= 250) {
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
      generatedBar = "🥷 Mid-Game-Crime Loop für stabiles Einkommen";
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

    saveState(ns, {
      ...currentState,
      strategy: mode,
      targetFaction: targetFaction || undefined,
      targetCompany: targetCompany,
      targetStat: mode === "TRAIN" ? targetStat : undefined,
      targetKills: mode === "KILLS" ? targetStat : undefined,
      progressBar: finalBar,
    });

   // --- 4. HINTERGRUND-DIENSTE ---
    // 🔥 RADIKALER EARLY-GAME-RIEGEL: 
    // Wenn wir unter 128GB RAM sind und Geld/XP brauchen, jagen wir JEDEN Hintergrund-Dienst vom Hof,
    // um die magischen 18.35 GB für tasks/crime.js freizuschaufeln.
    const isEarlyGameCrime =
      homeMaxRam < 128 &&
      (mode === "CRIME" || mode === "XP_SPRINT" || mode === "KILLS");

    if (isEarlyGameCrime) {
      // Falls noch aktiv, beenden wir Shopping sofort
      if (ns.isRunning("tasks/faction-shopping.js", "home")) {
        ns.print(
          "🛑 [Dispatcher] Schließe faction-shopping für Crime-RAM-Priorität.",
        );
        ns.scriptKill("tasks/faction-shopping.js", "home");
      }

      // Sicherheits-Check für Hacknet-Skripte (Sperrliste erweitert)
      const rogueScripts = [
        "tasks/hacknet.js",
        "tasks/hacknet-early.js"
      ];
      for (const script of rogueScripts) {
        if (ns.fileExists(script, "home") && ns.isRunning(script, "home")) {
          ns.print(
            `🛑 [Dispatcher] Schließe ${script} für Crime-RAM-Priorität.`,
          );
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

      if (
        ns.fileExists("Formulas.exe", "home") &&
        !ns.isRunning("core/sys-batcher.js", "home") &&
        getFreeRam() > 20
      ) {
        ns.print("🚀 Dispatcher: Formulas.exe aktiv! Starte HWGW-Batcher...");
        ns.run("core/sys-batcher.js", 1);
      }

      if (
        homeMaxRam >= 128 &&
        !ns.isRunning("utils/fill-ram.js", "home") &&
        getFreeRam() > 15
      ) {
        ns.print("🚀 [Dispatcher] 128GB+ RAM erreicht. Starte RAM-Filler...");
        ns.run("utils/fill-ram.js", 1);
      }
    }

    // --- 5. EXECUTION LAYER ---
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

  // 1. Alle unpassenden Microservices killen
  for (const [mode, script] of Object.entries(modeToScript)) {
    if (script !== targetScript && ns.isRunning(script, "home")) {
      ns.scriptKill(script, "home");
    }
  }

  // 2. Target-Script starten mit RAM-Check und Feedback
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
      // 🔥 LAUTSTARKE WARNUNG IM LOG
      ns.print(
        `⚠️ [Dispatcher] RAM-MANGEL! ${targetScript} benötigt ${requiredRam.toFixed(2)} GB. Frei: ${freeRam.toFixed(2)} GB.`,
      );
      ns.print(
        `👉 Tipp: Kill ein paar Threads deiner Hacking-Scripts auf 'home', um Platz zu machen!`,
      );
    }
  }
}
