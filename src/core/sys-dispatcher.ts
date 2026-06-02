import { NS, Player, FactionName, CompanyName } from "@ns";
import { createProgressBar } from "../lib/ui.js";
import { saveState, BotState } from "./state-manager.js";
// 1. IMPORT AUS DEINER NETWORK-LIB:
// (Hier nehmen wir an, dass deine network.ts eine Funktion hat, die das Netz scannt und nuked)
import { breakAndInfectNetwork } from "../lib/network.js"; 

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

const HACKING_FACTIONS = [
  // === PHASE 1: EARLY UTILITY & AUTOMATION ===
  { name: "CyberSec" as FactionName, minStat: 0 },
  { name: "Tian Di Hui" as FactionName, minStat: 0 },
  { name: "Netburners" as FactionName, minStat: 0 },

  // === PHASE 2: DIE PURE HACKING-HAUPTSTRASSE ===
  { name: "NiteSec" as FactionName, minStat: 0 },
  { name: "The Black Hand" as FactionName, minStat: 0 },
  { name: "BitRunners" as FactionName, minStat: 0 },

  // === PHASE 3: STÄDTE ===
  { name: "Sector-12" as FactionName, minStat: 0 },
  { name: "Aevum" as FactionName, minStat: 0 },
  { name: "Volhaven" as FactionName, minStat: 0 },
  { name: "Chongqing" as FactionName, minStat: 0 },
  { name: "New Tokyo" as FactionName, minStat: 0 },
  { name: "Ishima" as FactionName, minStat: 0 },

  // === PHASE 4: KAMPF & SYNDIKATE ===
  { name: "Slum Snakes" as FactionName, minStat: 30 },
  { name: "Tetrads" as FactionName, minStat: 75 },
  { name: "The Syndicate" as FactionName, minStat: 200 },
  { name: "The Dark Army" as FactionName, minStat: 300 },
  { name: "Speakers for the Dead" as FactionName, minStat: 300 },

  // === PHASE 5: ULTRALATE-GAME / ENDGAME ===
  { name: "The Covenant" as FactionName, minStat: 850 },
  { name: "Illuminati" as FactionName, minStat: 1200 },
  { name: "Daedalus" as FactionName, minStat: 1500 },

  // === PHASE 6: MEGACORPS ===
  { name: "ECorp" as FactionName, minStat: 0 },
  { name: "MegaCorp" as FactionName, minStat: 0 },
  { name: "KuaiGong International" as FactionName, minStat: 0 },
  { name: "Four Sigma" as FactionName, minStat: 0 },
  { name: "NWO" as FactionName, minStat: 0 },
  { name: "Blade Industries" as FactionName, minStat: 0 },
  { name: "OmniTek Incorporated" as FactionName, minStat: 0 },
  { name: "Bachman & Associates" as FactionName, minStat: 0 },
  { name: "Clarke Incorporated" as FactionName, minStat: 0 },
  { name: "Fulcrum Secret Technologies" as FactionName, minStat: 0 },
  { name: "Silhouette" as FactionName, minStat: 0 },
];

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const sing = ns.singularity;

  while (true) {
    // ----------------------------------------------------------------------
    // 0. NETZWERK AUFKLÄREN & ERWEITERN (network.ts Einbindung)
    // ----------------------------------------------------------------------
    // Holt bei jedem Schleifendurchlauf Admin-Rechte auf neu erreichbaren Servern
    breakAndInfectNetwork(ns); 

    let mode = "MONEY";
    const p = ns.getPlayer();
    const homeMaxRam = ns.getServerMaxRam("home");
    const freeRam = homeMaxRam - ns.getServerUsedRam("home");

    let targetFaction: FactionName | null = null;
    let targetCompany: CompanyName | undefined = undefined;
    let targetStat = 0;

    // --- 1. ENTSCHEIDUNGS-MATRIX ---
    const factionToWorkFor = findNextFaction(ns, p);

    if (factionToWorkFor) {
      mode = "REP";
      targetFaction = factionToWorkFor;
    } else if (p.skills.hacking < 50) {
      mode = "XP_SPRINT";
    } else if (homeMaxRam < 32) {
      mode = "MONEY";
    } else {
      // Prüfen, ob wir Firmen-Ruf für Megacorps grinden müssen
      const missingCorpFaction = HACKING_FACTIONS.find(
        (f) =>
          !p.factions.includes(f.name) &&
          MEGACORPS[f.name] !== undefined &&
          sing.getCompanyRep(MEGACORPS[f.name]) < 400_000 &&
          getHighestRepNeeded(ns, f.name) > 0,
      );

      if (missingCorpFaction) {
        mode = "CORP";
        targetCompany = MEGACORPS[missingCorpFaction.name];
      } else {
        
        // DYNAMISCHER MINSTAT-CHECK (Deine Idee! Ersetzt das alte MILESTONES-Array)
        // Wir suchen die allernächste Fraktion im Array, in der wir noch KEIN Mitglied sind,
        // und die Kampf-Stats (minStat > 0) verlangt.
        const nextLockedCombatFaction = HACKING_FACTIONS.find(
          (f) => !p.factions.includes(f.name) && f.minStat > 0
        );

        if (nextLockedCombatFaction) {
          // Prüfen, ob unsere Kampfstats schon ausreichen
          const currentLowestCombatStat = Math.min(...COMBAT_STATS.map((s) => p.skills[s]));
          
          if (currentLowestCombatStat < nextLockedCombatFaction.minStat) {
            // Wenn wir das Level für das nächste Syndikat noch nicht haben -> Trainieren!
            mode = "TRAIN";
            targetStat = nextLockedCombatFaction.minStat;
            targetFaction = nextLockedCombatFaction.name; // Merken für die UI-Anzeige
          } else {
            mode = "MONEY";
          }
        } else {
          mode = "MONEY";
        }
      }
    }

    // --- 2. STATE SCHREIBEN / UI GENERIEREN ---
    let generatedBar = "";

    if (mode === "XP_SPRINT") {
      generatedBar = "👶 Early Game: XP SPRINT";
    } else if (mode === "CORP" && targetCompany) {
      const currentCompanyRep = sing.getCompanyRep(targetCompany);
      generatedBar = `Corp: ${targetCompany} ${createProgressBar(currentCompanyRep, 400_000)}`;
    } else if (mode === "REP" && targetFaction) {
      const currentFactionRep = sing.getFactionRep(targetFaction);
      const targetFactionRep = getHighestRepNeeded(ns, targetFaction);
      generatedBar = `${targetFaction} ${createProgressBar(currentFactionRep, targetFactionRep)}`;
    } else if (mode === "TRAIN") {
      // UI-OPTIMIERUNG: Zeigt jetzt genau an, für welche Fraktion wir gerade trainieren!
      const lowestCombatStat = Math.min(...COMBAT_STATS.map((s) => p.skills[s]));
      generatedBar = `🏋️ Train für ${targetFaction}: ${lowestCombatStat}/${targetStat} ${createProgressBar(lowestCombatStat, targetStat)}`;
    } else {
      generatedBar = `💰 Grind Money (Batcher / Crime)`;
    }

    const state: BotState = {
      strategy: mode,
      targetFaction: targetFaction || undefined,
      targetCompany: targetCompany,
      targetStat: mode === "TRAIN" ? targetStat : undefined,
      progressBar: generatedBar,
    };

    saveState(ns, state);

    // --- 4. MICROSERVICES DELEGIEREN ---
    if (freeRam > 12 && !ns.isRunning("tasks/faction-shopping.js", "home")) {
      ns.run("tasks/faction-shopping.js", 1);
    }

    const hasFormulas = ns.fileExists("Formulas.exe", "home");

    if (mode === "REP" && !ns.isRunning("tasks/faction-grind.js", "home") && freeRam > 12) {
      ns.scriptKill("tasks/crime.js", "home");
      ns.scriptKill("core/sys-batcher.js", "home");
      ns.scriptKill("tasks/train.js", "home");
      ns.scriptKill("tasks/corp.js", "home");
      ns.run("tasks/faction-grind.js", 1);
    } 
    else if (mode === "CORP" && !ns.isRunning("tasks/corp.js", "home") && freeRam > 4) {
      ns.scriptKill("tasks/faction-grind.js", "home");
      ns.scriptKill("tasks/crime.js", "home");
      ns.scriptKill("tasks/train.js", "home");
      ns.run("tasks/corp.js", 1);
    } 
    else if (mode === "TRAIN" && !ns.isRunning("tasks/train.js", "home") && freeRam > 4) {
      ns.scriptKill("tasks/faction-grind.js", "home");
      ns.scriptKill("tasks/corp.js", "home");
      ns.scriptKill("tasks/crime.js", "home");
      ns.run("tasks/train.js", 1);
    } 
    else if (mode === "MONEY" || mode === "XP_SPRINT") {
      if (hasFormulas && mode === "MONEY") {
        if (!ns.isRunning("core/sys-batcher.js", "home") && freeRam > 20) {
          ns.scriptKill("tasks/crime.js", "home");
          ns.scriptKill("tasks/faction-grind.js", "home");
          ns.scriptKill("tasks/train.js", "home");
          ns.scriptKill("tasks/corp.js", "home");
          ns.print("🚀 Dispatcher: Formulas aktiv! Starte sys-batcher...");
          ns.run("core/sys-batcher.js", 1);
        }
      } else {
        if (!ns.isRunning("tasks/crime.js", "home") && freeRam > 5) {
          ns.scriptKill("core/sys-batcher.js", "home");
          ns.scriptKill("tasks/faction-grind.js", "home");
          ns.scriptKill("tasks/corp.js", "home");
          ns.scriptKill("tasks/train.js", "home");
          ns.print("💪 Dispatcher: Starte Crime-Grind...");
          ns.run("tasks/crime.js", 1);
        }
      }
    }

    await ns.sleep(5000);
  }
}

function findNextFaction(ns: NS, p: Player): FactionName | null {
  for (const f of HACKING_FACTIONS) {
    if (p.factions.includes(f.name)) {
      const repNeeded = getHighestRepNeeded(ns, f.name);
      if (repNeeded > 0 && ns.singularity.getFactionRep(f.name) < repNeeded) {
        return f.name;
      }
    }
  }
  return null;
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