import { NS, Player, FactionName, CompanyName } from "@ns";
import { createProgressBar } from "../lib/ui.js";
import { saveState, BotState } from "./state-manager.js";
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
        const nextLockedCombatFaction = HACKING_FACTIONS.find(
          (f) => !p.factions.includes(f.name) && f.minStat > 0,
        );

        if (nextLockedCombatFaction) {
          const currentLowestCombatStat = Math.min(
            ...COMBAT_STATS.map((s) => p.skills[s]),
          );

          if (currentLowestCombatStat < nextLockedCombatFaction.minStat) {
            mode = "TRAIN";
            targetStat = nextLockedCombatFaction.minStat;
            targetFaction = nextLockedCombatFaction.name;
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
      const lowestCombatStat = Math.min(
        ...COMBAT_STATS.map((s) => p.skills[s]),
      );
      generatedBar = `🏋️ Train für ${targetFaction}: ${lowestCombatStat}/${targetStat} ${createProgressBar(lowestCombatStat, targetStat)}`;
    } else {
      generatedBar = "💰 Grind Money (Batcher / Crime)";
    }

    const state: BotState = {
      strategy: mode,
      targetFaction: targetFaction || undefined,
      targetCompany: targetCompany,
      targetStat: mode === "TRAIN" ? targetStat : undefined,
      progressBar: generatedBar,
    };

    saveState(ns, state);

    // ======================================================================
    // --- 4. GLOBALER BACKGROUND-BATCHER (Entkoppelt von den Modi) ---
    // ======================================================================

    if (freeRam > 12 && !ns.isRunning("tasks/faction-shopping.js", "home")) {
      ns.run("tasks/faction-shopping.js", 1);
    }

    const hasFormulas = ns.fileExists("Formulas.exe", "home");
    if (hasFormulas) {
      // Wenn Formulas da ist, MUSS der Batcher immer laufen, egal welcher Modus aktiv ist!
      if (!ns.isRunning("core/sys-batcher.js", "home") && freeRam > 20) {
        ns.scriptKill("tasks/crime.js", "home"); // Crime verträgt sich nicht mit Batching
        ns.print(
          "🚀 Dispatcher [GLOBAL]: Formulas aktiv! Starte Hintergrund-Batcher...",
        );
        ns.run("core/sys-batcher.js", 1);
      }
    }

    // ======================================================================
    // --- 5. SINGULARITY MICROSERVICES (Strategie-Ausführung) ---
    // ======================================================================
    if (
      mode === "REP" &&
      !ns.isRunning("tasks/faction-grind.js", "home") &&
      freeRam > 12
    ) {
      ns.scriptKill("tasks/crime.js", "home");
      ns.scriptKill("tasks/train.js", "home");
      ns.scriptKill("tasks/corp.js", "home");
      // HINWEIS: sys-batcher wird NICHT mehr gekillt!
      ns.run("tasks/faction-grind.js", 1);
    } else if (
      mode === "CORP" &&
      !ns.isRunning("tasks/corp.js", "home") &&
      freeRam > 4
    ) {
      ns.scriptKill("tasks/faction-grind.js", "home");
      ns.scriptKill("tasks/crime.js", "home");
      ns.scriptKill("tasks/train.js", "home");
      // HINWEIS: sys-batcher wird NICHT mehr gekillt!
      ns.run("tasks/corp.js", 1);
    } else if (
      mode === "TRAIN" &&
      !ns.isRunning("tasks/train.js", "home") &&
      freeRam > 4
    ) {
      ns.scriptKill("tasks/faction-grind.js", "home");
      ns.scriptKill("tasks/corp.js", "home");
      ns.scriptKill("tasks/crime.js", "home");
      // HINWEIS: sys-batcher wird NICHT mehr gekillt!
      ns.run("tasks/train.js", 1);
    } else if (mode === "MONEY" || mode === "XP_SPRINT") {
      if (!hasFormulas) {
        // Crime ist nur unser Fallback im absoluten Early-Game ohne Formulas
        if (!ns.isRunning("tasks/crime.js", "home") && freeRam > 5) {
          ns.scriptKill("tasks/faction-grind.js", "home");
          ns.scriptKill("tasks/corp.js", "home");
          ns.scriptKill("tasks/train.js", "home");
          ns.print("💪 Dispatcher: Kein Formulas. Starte Crime-Grind...");
          ns.run("tasks/crime.js", 1);
        }
      } else {
        // Wenn wir Formulas haben, läuft der Batcher oben schon.
        // Wir stellen nur sicher, dass kein altes Crime-Skript RAM klaut.
        ns.scriptKill("tasks/crime.js", "home");
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
