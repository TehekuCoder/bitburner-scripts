import { NS, Player, FactionName, CompanyName } from "@ns";
import { createProgressBar } from "../lib/ui.js";
import { saveState, BotState } from "./state-manager.js";
import { breakAndInfectNetwork } from "../lib/network.js";

const COMBAT_STATS: (keyof Player["skills"])[] = ["strength", "defense", "dexterity", "agility"];

const MEGACORPS: Record<string, CompanyName> = {
  ECorp: "ECorp", MegaCorp: "MegaCorp", "KuaiGong International": "KuaiGong International",
  "Four Sigma": "Four Sigma", NWO: "NWO", "Blade Industries": "Blade Industries",
  "OmniTek Incorporated": "OmniTek Incorporated", "Bachman & Associates": "Bachman & Associates",
  "Clarke Incorporated": "Clarke Incorporated", "Fulcrum Secret Technologies": "Fulcrum Technologies",
};

const HACKING_FACTIONS = [
  // === PHASE 1: EARLY UTILITY ===
  { name: "CyberSec" as FactionName, minStat: 0 },
  { name: "Tian Di Hui" as FactionName, minStat: 0 },
  { name: "Netburners" as FactionName, minStat: 0 },
  // === PHASE 2: HACKING-HAUPTSTRASSE ===
  { name: "NiteSec" as FactionName, minStat: 0 },
  { name: "The Black Hand" as FactionName, minStat: 0 },
  { name: "BitRunners" as FactionName, minStat: 0 },
  // === PHASE 3: STÄDTE ===
  { name: "Sector-12" as FactionName, minStat: 0 },
  { name: "Aevum" as FactionName, minStat: 0 },
  { name: "Volhaven" as FactionName, minStat: 0 },
  // === PHASE 4: SYNDIKATE ===
  { name: "Slum Snakes" as FactionName, minStat: 30 },
  { name: "Tetrads" as FactionName, minStat: 75 },
  { name: "The Syndicate" as FactionName, minStat: 200 },
  { name: "The Dark Army" as FactionName, minStat: 300 },
  { name: "Speakers for the Dead" as FactionName, minStat: 300 },
  // === PHASE 5: ENDGAME ===
  { name: "The Covenant" as FactionName, minStat: 850 },
  { name: "Illuminati" as FactionName, minStat: 1200 },
  { name: "Daedalus" as FactionName, minStat: 1500 },
];

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  
  // Helfer für dynamische RAM-Abfrage zur Vermeidung von Race Conditions
  const getFreeRam = () => ns.getServerMaxRam("home") - ns.getServerUsedRam("home");
  const hasSingularity = ns.singularity !== undefined;

  while (true) {
    // Netzwerk-Infektion läuft IMMER, komplett unabhängig von APIs oder RAM
    breakAndInfectNetwork(ns);

    let mode = "MONEY";
    const p = ns.getPlayer();
    const homeMaxRam = ns.getServerMaxRam("home");

    let targetFaction: FactionName | null = null;
    let targetCompany: CompanyName | undefined = undefined;
    let targetStat = 0;

    // --- 1. ENTSCHEIDUNGS-MATRIX (Mit SF4-Schutz) ---
    if (!hasSingularity) {
      // OHNE Singularity (SF4 fehlt) kann der Dispatcher keine Microservices steuern.
      // Er schaltet permanent auf "PURE_HACK" und überlässt dem Batcher/Skripten das Feld.
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
        // PRIORITÄT 1: KAMPF-TRAINING (Syndikate)
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

        // PRIORITÄT 2: MEGACORPS
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

    // --- 2. UI & STATE GENERIERUNG ---
    let generatedBar = "";
    if (mode === "PURE_HACK") {
      generatedBar = "🌐 Automatisiertes Hacking-Netzwerk aktiv (Kein SF4)";
    } else if (mode === "XP_SPRINT") {
      generatedBar = "👶 Early Game: XP SPRINT";
    } else if (mode === "CORP" && targetCompany) {
      const currentCompanyRep = ns.singularity.getCompanyRep(targetCompany);
      generatedBar = `Corp: ${targetCompany} ${createProgressBar(currentCompanyRep, 400_000)}`;
    } else if (mode === "REP" && targetFaction) {
      const currentFactionRep = ns.singularity.getFactionRep(targetFaction);
      const targetFactionRep = getHighestRepNeeded(ns, targetFaction);
      generatedBar = `${targetFaction} ${createProgressBar(currentFactionRep, targetFactionRep)}`;
    } else if (mode === "TRAIN") {
      const lowestCombatStat = Math.min(...COMBAT_STATS.map((s) => p.skills[s]));
      generatedBar = `🏋️ ${lowestCombatStat}/${targetStat} ${createProgressBar(lowestCombatStat, targetStat)}`;
    } else {
      generatedBar = "💰 Grind Money (Batcher / Crime)";
    }

    saveState(ns, {
      strategy: mode,
      targetFaction: targetFaction || undefined,
      targetCompany: targetCompany,
      targetStat: mode === "TRAIN" ? targetStat : undefined,
      progressBar: generatedBar,
    });

    // --- 3. GLOBAL BACKGROUND SERVICES (Mit Live-RAM Check) ---
    if (hasSingularity && getFreeRam() > 12 && !ns.isRunning("tasks/faction-shopping.js", "home")) {
      ns.run("tasks/faction-shopping.js", 1);
    }

    const hasFormulas = ns.fileExists("Formulas.exe", "home");
    if (hasFormulas && !ns.isRunning("core/sys-batcher.js", "home") && getFreeRam() > 20) {
      ns.scriptKill("tasks/crime.js", "home"); 
      ns.print("🚀 Dispatcher: Formulas aktiv! Starte Hintergrund-Batcher...");
      ns.run("core/sys-batcher.js", 1);
    }

    // --- 4. MICROSERVICES EXECUTION LAYER ---
    if (!hasSingularity) {
      // Wenn wir kein SF4 haben, lassen wir einfach den Batcher laufen (oben getriggert)
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
      if (!hasFormulas) {
        if (!ns.isRunning("tasks/crime.js", "home") && getFreeRam() > 5) {
          ns.scriptKill("tasks/faction-grind.js", "home");
          ns.scriptKill("tasks/corp.js", "home");
          ns.scriptKill("tasks/train.js", "home");
          ns.run("tasks/crime.js", 1);
        }
      } else {
        ns.scriptKill("tasks/crime.js", "home");
      }
    }

    await ns.sleep(5000);
  }
}

function findNextFaction(ns: NS, p: Player): FactionName | null {
  // OPTIMIERT: Sucht zuerst nach Fraktionen, bei denen wir SCHON Mitglied sind
  // UND wo wir die Rufanforderungen am schnellsten abschließen können (kleinster verbleibender Ruf)
  const activeFactionJobs = HACKING_FACTIONS
    .filter((f) => p.factions.includes(f.name))
    .map((f) => {
      const repNeeded = getHighestRepNeeded(ns, f.name);
      const currentRep = ns.singularity.getFactionRep(f.name);
      return { name: f.name, missingRep: repNeeded - currentRep };
    })
    .filter((f) => f.missingRep > 0)
    // Sortiere nach dem am schnellsten erreichbaren Ziel (die mit dem wenigsten fehlenden Ruf zuerst)
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