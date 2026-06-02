import { NS, Player, FactionName, CompanyName } from "@ns";
import { createProgressBar } from "../lib/ui.js";
import { saveState, BotState } from "./state-manager.js";

const MILESTONES = [0, 100, 200, 300, 850, 1200, 1500];

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
  { name: "Daedalus" as FactionName, minStat: 1500 },
  { name: "Illuminati" as FactionName, minStat: 1200 },
  { name: "The Covenant" as FactionName, minStat: 850 },

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
    let mode = "MONEY";
    const p = ns.getPlayer();
    const homeMaxRam = ns.getServerMaxRam("home");
    const freeRam = homeMaxRam - ns.getServerUsedRam("home");

    let reachedM = 0;
    let targetFaction: FactionName | null = null;
    let targetCompany: CompanyName | undefined = undefined;
    let targetStat = 0;

    // --- 1. ENTSCHEIDUNGS-MATRIX ---
    for (const m of MILESTONES) {
      if (COMBAT_STATS.every((s) => p.skills[s] >= m)) reachedM = m;
      else break;
    }

    const factionToWorkFor = findNextFaction(ns, p);
    targetStat = reachedM;

    if (factionToWorkFor) {
      mode = "REP";
      targetFaction = factionToWorkFor;
    } else if (p.skills.hacking < 50) {
      mode = "XP_SPRINT";
    } else if (homeMaxRam < 32) {
      mode = "MONEY";
    } else {
      // FIX: Suche gezielt nur nach Megacorps, bei denen wir aktiv Firmen-Ruf grinden müssen
      const missingCorpFaction = HACKING_FACTIONS.find(
        (f) =>
          f.minStat <= reachedM &&
          !p.factions.includes(f.name) &&
          MEGACORPS[f.name] !== undefined &&
          sing.getCompanyRep(MEGACORPS[f.name]) < 400_000 &&
          getHighestRepNeeded(ns, f.name) > 0,
      );

      if (missingCorpFaction) {
        mode = "CORP";
        targetCompany = MEGACORPS[missingCorpFaction.name];
      } else {
        // FIX: Wenn keine Corp Arbeit ansteht, sauber zum nächsten Kampf-Milestone wechseln
        const nextM = MILESTONES.find((m) => m > reachedM);
        if (nextM) {
          mode = "TRAIN";
          targetStat = nextM;
        } else {
          mode = "MONEY";
        }
      }
    }

    // --- 2. STATE SCHREIBEN ---
    let generatedBar = "";

    if (mode === "XP_SPRINT") {
      generatedBar = "👶 Early Game: XP SPRINT";
    } else if (mode === "CORP" && targetCompany) {
      const currentCompanyRep = sing.getCompanyRep(targetCompany);
      const targetCompanyRep = 400_000;
      generatedBar = `Corp: ${targetCompany} ${createProgressBar(currentCompanyRep, targetCompanyRep)}`;
    } else if (mode === "REP" && targetFaction) {
      const currentFactionRep = sing.getFactionRep(targetFaction);
      const targetFactionRep = getHighestRepNeeded(ns, targetFaction);
      generatedBar = `${targetFaction} ${createProgressBar(currentFactionRep, targetFactionRep)}`;
    } else if (mode === "TRAIN") {
      const lowestCombatStat = Math.min(
        ...COMBAT_STATS.map((s) => p.skills[s]),
      );
      generatedBar = `Train to ${targetStat} ${createProgressBar(lowestCombatStat, targetStat)}`;
    } else {
      generatedBar = `💰 Grind Money (Milestone: ${reachedM})`;
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

    if (
      mode === "REP" &&
      !ns.isRunning("tasks/faction-grind.js", "home") &&
      freeRam > 12
    ) {
      ns.scriptKill("tasks/crime.js", "home");
      ns.scriptKill("core/sys-batcher.js", "home");
      ns.scriptKill("tasks/train.js", "home");
      ns.scriptKill("tasks/corp.js", "home");
      ns.run("tasks/faction-grind.js", 1);
    } else if (
      mode === "CORP" &&
      !ns.isRunning("tasks/corp.js", "home") &&
      freeRam > 4
    ) {
      ns.scriptKill("tasks/faction-grind.js", "home");
      ns.scriptKill("tasks/crime.js", "home");
      ns.scriptKill("tasks/train.js", "home");
      ns.run("tasks/corp.js", 1);
    } else if (
      mode === "TRAIN" &&
      !ns.isRunning("tasks/train.js", "home") &&
      freeRam > 4
    ) {
      ns.scriptKill("tasks/faction-grind.js", "home");
      ns.scriptKill("tasks/corp.js", "home");
      ns.scriptKill("tasks/crime.js", "home");
      ns.run("tasks/train.js", 1);
    }
    // FIX: Die äußere Bedingung prüft NUR noch die Modi. Der RAM-Check ist dynamisch innen.
    else if (mode === "MONEY" || mode === "XP_SPRINT") {
      if (hasFormulas && mode === "MONEY") {
        // SZenario A: High-End Batching (Formulas vorhanden)
        if (!ns.isRunning("core/sys-batcher.js", "home") && freeRam > 20) {
          ns.scriptKill("tasks/crime.js", "home");
          ns.scriptKill("tasks/faction-grind.js", "home");
          ns.scriptKill("tasks/train.js", "home");
          ns.scriptKill("tasks/corp.js", "home");

          ns.print("🚀 Dispatcher: Formulas aktiv! Starte sys-batcher...");
          ns.run("core/sys-batcher.js", 1);
        }
      } else {
        // Szenario B: Early-Game Geld/XP über Crime (Kein Formulas oder XP_SPRINT)
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

// --- HILFSFUNKTIONEN FÜR DISPATCHER-LOGIK ---
// FIX: reachedM entfernt. Wenn wir in der Fraktion sind, wollen wir dort arbeiten!
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
