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

// Globaler Cache für Augmentations-Preise (verhindert CPU-Lag)
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

  // Telemetrie für stabile ETA-Berechnungen
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

    // --- 1. STRATEGIE-MATRIX ---
    const factionToWorkFor = findNextFaction(ns, p);

    if (factionToWorkFor) {
      mode = "REP";
      targetFaction = factionToWorkFor;
    } else if (p.skills.hacking < 50) {
      mode = "XP_SPRINT";
    } else if (homeMaxRam < 128) {
      mode = "MONEY";
    } else {
      // Kampf-Fraktionen prüfen
      const nextLockedCombatFaction = HACKING_FACTIONS.find(
        (f) => !p.factions.includes(f.name) && f.minStat > 0,
      );

      if (nextLockedCombatFaction) {
        // 💀 Dynamische Kill-Anforderungen ermitteln
        let requiredKills = 0;
        if (nextLockedCombatFaction.name === "The Dark Army") requiredKills = 5;
        if (nextLockedCombatFaction.name === "Speakers for the Dead")
          requiredKills = 30;

        const currentLowestCombatStat = Math.min(
          ...COMBAT_STATS.map((s) => p.skills[s]),
        );
        // Prio 1: Haben wir genug Leichen im Keller?
        if (p.numPeopleKilled < requiredKills) {
          mode = "KILLS";
          targetStat = requiredKills; // Missbraucht als temporärer Speicher für die Anzeige
          targetFaction = nextLockedCombatFaction.name;
        }
        // Prio 2: Wenn Kills passen, Stats ins Ziel bringen
        else if (currentLowestCombatStat < nextLockedCombatFaction.minStat) {
          mode = "TRAIN";
          targetStat = nextLockedCombatFaction.minStat;
          targetFaction = nextLockedCombatFaction.name;
        }
      }

      // Megacorporations prüfen (für End-Game Fraktionen)
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

    // ETA Formatierung
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
    } else {
      generatedBar = "💰 Maximiere Profit (Batcher / Crime)";
    }

    const currentState = loadState(ns);
    let finalBar = generatedBar;

    if (
      (mode === "MONEY" || mode === "XP_SPRINT") &&
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

    // --- 4. HINTERGRUND-DIENSTE (ORCHESTRIERUNG) ---
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

    if (!ns.isRunning("utils/fill-ram.js", "home") && getFreeRam() > 15) {
      ns.run("utils/fill-ram.js", 1);
    }

    if (hasSingularity) {
      // 1. TOR Router kaufen (Kostet 250k)
      if (!ns.hasTorRouter() && p.money >= 250_000) {
        ns.print("🛒 [Dispatcher] Kaufe TOR-Router...");
        ns.singularity.purchaseTor();
      }

      // 2. Brute.exe kaufen (Kostet 500k, setzt TOR voraus)
      if (
        ns.hasTorRouter() &&
        !ns.fileExists("BruteSSH.exe", "home") &&
        p.money >= 500_000
      ) {
        ns.print("🛒 [Dispatcher] Kaufe Brute.exe...");
        ns.singularity.purchaseProgram("BruteSSH.exe");
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
    MONEY: "tasks/crime.js",
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
    const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
    if (freeRam > ns.getScriptRam(targetScript, "home")) {
      ns.run(targetScript, 1);
    }
  }
}
