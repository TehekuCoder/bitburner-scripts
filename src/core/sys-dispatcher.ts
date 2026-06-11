import { NS, Player, FactionName, CompanyName } from "@ns";
import { createProgressBar } from "../lib/ui.js";
import { loadState, saveState, BotState } from "./state-manager.js";
import { breakAndInfectNetwork } from "../lib/network.js";

const COMBAT_STATS: (keyof Player["skills"])[] = ["strength", "defense", "dexterity", "agility"];

const MEGACORPS: Record<string, CompanyName> = {
  ECorp: "ECorp", MegaCorp: "MegaCorp", "KuaiGong International": "KuaiGong International",
  "Four Sigma": "Four Sigma", NWO: "NWO", "Blade Industries": "Blade Industries",
  "OmniTek Incorporated": "OmniTek Incorporated", "Bachman & Associates": "Bachman & Associates",
  "Clarke Incorporated": "Clarke Incorporated", "Fulcrum Secret Technologies": "Fulcrum Technologies",
};

const HACKING_FACTIONS = [
  { name: "CyberSec" as FactionName, minStat: 0 },
  { name: "Tian Di Hui" as FactionName, minStat: 0 },
  { name: "Netburners" as FactionName, minStat: 0 },
  { name: "NiteSec" as FactionName, minStat: 0 },
  { name: "The Black Hand" as FactionName, minStat: 0 },
  { name: "BitRunners" as FactionName, minStat: 0 },
  { name: "Sector-12" as FactionName, minStat: 0 },
  { name: "Aevum" as FactionName, minStat: 0 },
  { name: "Volhaven" as FactionName, minStat: 0 },
  { name: "Slum Snakes" as FactionName, minStat: 30 },
  { name: "Tetrads" as FactionName, minStat: 75 },
  { name: "The Syndicate" as FactionName, minStat: 200 },
  { name: "The Dark Army" as FactionName, minStat: 300 },
  { name: "Speakers for the Dead" as FactionName, minStat: 300 },
  { name: "The Covenant" as FactionName, minStat: 850 },
  { name: "Illuminati" as FactionName, minStat: 1200 },
  { name: "Daedalus" as FactionName, minStat: 1500 },
];

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  
  const getFreeRam = () => ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
  const hasSingularity = ns.singularity !== undefined;

  // --- TELEMETRIE-VARIABLEN FÜR DIE ETA-BERECHNUNG ---
  let lastValue = 0;
  let lastTime = Date.now();
  let emaRate = 0; // Exponential Moving Average für stabile Zeitschätzungen
  let lastMode = "";

  while (true) {
    breakAndInfectNetwork(ns);

    let mode = "MONEY";
    const p = ns.getPlayer();
    const homeMaxRam = ns.getServerMaxRam("home");

    let targetFaction: FactionName | null = null;
    let targetCompany: CompanyName | undefined = undefined;
    let targetStat = 0;

    // --- 1. ENTSCHEIDUNGS-MATRIX ---
    if (!hasSingularity) {
      mode = "PURE_HACK";
    } else {
      const factionToWorkFor = findNextFaction(ns, p);

      if (factionToWorkFor) {
        mode = "REP";
        targetFaction = factionToWorkFor;
      } else if (p.skills.hacking < 50) {
        mode = "XP_SPRINT";
      } else if (homeMaxRam < 128) {
        mode = "MONEY";
      } else {
        const nextLockedCombatFaction = HACKING_FACTIONS.find(
          (f) => !p.factions.includes(f.name) && f.minStat > 0
        );

        if (nextLockedCombatFaction) {
          const currentLowestCombatStat = Math.min(...COMBAT_STATS.map((s) => p.skills[s]));
          if (currentLowestCombatStat < nextLockedCombatFaction.minStat) {
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
              getHighestRepNeeded(ns, f.name) > 0
          );

          if (missingCorpFaction) {
            mode = "CORP";
            targetCompany = MEGACORPS[missingCorpFaction.name];
          }
        }
      }
    }

    // --- 2. DYNAMISCHE METRIK-ERFASSUNG & ETA ENGINE ---
    let currentVal = 0;
    let targetVal = 0;
    let label = "";

    if (mode === "REP" && targetFaction) {
      currentVal = ns.singularity.getFactionRep(targetFaction);
      targetVal = getHighestRepNeeded(ns, targetFaction);
      label = `Fraktion: ${targetFaction}`;
    } else if (mode === "CORP" && targetCompany) {
      currentVal = ns.singularity.getCompanyRep(targetCompany);
      targetVal = 400_000;
      label = `Corp: ${targetCompany}`;
    } else if (mode === "TRAIN") {
      currentVal = Math.min(...COMBAT_STATS.map((s) => p.skills[s]));
      targetVal = targetStat;
      label = `🏋️ Training (Combat-Stats)`;
    }

    // Echtzeit-Berechnung des Zuwachses pro Sekunde
    const now = Date.now();
    if (mode !== lastMode) {
      lastValue = currentVal;
      lastTime = now;
      emaRate = 0;
      lastMode = mode;
    } else if (targetVal > 0) {
      const timeDiff = now - lastTime;
      if (timeDiff >= 4000) { // Berechnung alle ~5 Sekunden
        const valDiff = currentVal - lastValue;
        if (valDiff > 0) {
          const instantRate = valDiff / (timeDiff / 1000);
          emaRate = emaRate === 0 ? instantRate : emaRate * 0.7 + instantRate * 0.3;
        }
        lastValue = currentVal;
        lastTime = now;
      }
    }

    // ETA-String Formatierung
    let etaStr = "Warte auf Daten...";
    if (targetVal === 0 && (mode === "REP" || mode === "CORP" || mode === "TRAIN")) {
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

    // --- 3. UI STRING ASSEMBLE ---
    let generatedBar = "";
    if (["REP", "CORP", "TRAIN"].includes(mode) && targetVal > 0) {
      const pct = ((currentVal / targetVal) * 100).toFixed(1);
      const curFormatted = ns.format.number(currentVal, 1);
      const tarFormatted = ns.format.number(targetVal, 1);
      generatedBar = `${label} | ${curFormatted}/${tarFormatted} (${pct}%) | ETA: ${etaStr}`;
    } else if (targetVal === 0 && mode === "REP" && targetFaction) {
      // BEHOBEN: Sonderfall für Tetrads Gang-Grind ohne offene Augmentationen
      generatedBar = `🥷 ${targetFaction} | Ruf: ${ns.format.number(ns.singularity.getFactionRep(targetFaction), 1)} | Karma-Farming`;
    } else if (mode === "PURE_HACK") {
      generatedBar = "🌐 Automatisiertes Hacking-Netzwerk aktiv (Kein SF4)";
    } else if (mode === "XP_SPRINT") {
      generatedBar = "👶 Early Game: XP SPRINT";
    } else {
      generatedBar = "💰 Grind Money (Batcher / Crime)";
    }

    const currentState = loadState(ns);
    
    // Weiche für Crime-Worker
    let finalBar = generatedBar;
    if ((mode === "MONEY" || mode === "XP_SPRINT") && ns.isRunning("tasks/crime.js", "home")) {
      if (currentState && currentState.progressBar && currentState.progressBar.startsWith("🥷")) {
        finalBar = currentState.progressBar;
      }
    }

    saveState(ns, {
      ...currentState,
      strategy: mode,
      targetFaction: targetFaction || undefined,
      targetCompany: targetCompany,
      targetStat: mode === "TRAIN" ? targetStat : undefined,
      progressBar: finalBar,
    });

    // --- 4. GLOBAL BACKGROUND SERVICES ---
    if (hasSingularity && getFreeRam() > 12 && !ns.isRunning("tasks/faction-shopping.js", "home")) {
      ns.run("tasks/faction-shopping.js", 1);
    }

    const hasFormulas = ns.fileExists("Formulas.exe", "home");
    if (hasFormulas && !ns.isRunning("core/sys-batcher.js", "home") && getFreeRam() > 20) {
      ns.print("🚀 Dispatcher: Formulas aktiv! Starte Hintergrund-Batcher...");
      ns.run("core/sys-batcher.js", 1);
    }

    // --- 5. MICROSERVICES EXECUTION LAYER ---
    if (!hasSingularity) {
      await ns.sleep(5000);
      continue;
    }

    if (mode === "REP" && !ns.isRunning("tasks/faction-grind.js", "home") && getFreeRam() > 12) {
      ns.scriptKill("tasks/crime.js", "home");
      ns.scriptKill("tasks/train.js", "home");
      ns.scriptKill("tasks/corp.js", "home");
      ns.run("tasks/faction-grind.js", 1);
    } else if (mode === "CORP" && !ns.isRunning("tasks/corp.js", "home") && getFreeRam() > 4) {
      ns.scriptKill("tasks/faction-grind.js", "home");
      ns.scriptKill("tasks/crime.js", "home");
      ns.scriptKill("tasks/train.js", "home");
      ns.run("tasks/corp.js", 1);
    } else if (mode === "TRAIN" && !ns.isRunning("tasks/train.js", "home") && getFreeRam() > 4) {
      ns.scriptKill("tasks/faction-grind.js", "home");
      ns.scriptKill("tasks/corp.js", "home");
      ns.scriptKill("tasks/crime.js", "home");
      ns.run("tasks/train.js", 1);
    } else if (mode === "MONEY" || mode === "XP_SPRINT") {
      const crimeScript = "tasks/crime.js";
      if (ns.fileExists(crimeScript, "home")) {
        const requiredRam = ns.getScriptRam(crimeScript, "home");
        if (!ns.isRunning(crimeScript, "home") && getFreeRam() > requiredRam) {
          ns.scriptKill("tasks/faction-grind.js", "home");
          ns.scriptKill("tasks/corp.js", "home");
          ns.scriptKill("tasks/train.js", "home");
          ns.run(crimeScript, 1);
        }
      }
    }

    await ns.sleep(5000);
  }
}

function findNextFaction(ns: NS, p: Player): FactionName | null {
  const activeFactionJobs = HACKING_FACTIONS
    .filter((f) => p.factions.includes(f.name))
    .map((f) => {
      const repNeeded = getHighestRepNeeded(ns, f.name);
      const currentRep = ns.singularity.getFactionRep(f.name);
      return { name: f.name, missingRep: repNeeded - currentRep };
    })
    .filter((f) => f.missingRep > 0)
    .sort((a, b) => a.missingRep - b.missingRep);

  return activeFactionJobs.length > 0 ? activeFactionJobs[0].name : null;
}

function getHighestRepNeeded(ns: NS, fName: FactionName): number {
  const ownedAugs = ns.singularity.getOwnedAugmentations(true);
  let highest = 0;
  for (const aug of ns.singularity.getAugmentationsFromFaction(fName)) {
    if (!ownedAugs.includes(aug) && aug !== "NeuroFlux Governor") {
      const req = ns.singularity.getAugmentationRepReq(aug);
      if (req > highest) highest = req;
    }
  }
  return highest;
}