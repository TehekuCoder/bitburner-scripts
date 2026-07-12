import { NS, FactionName, FactionWorkType, CompanyName } from "@ns";
import { loadState } from "./state-manager.js";
import { Logger } from "./logger.js"; // 📝 Euren Logger importieren

const MEGACORPS = [
  "ECorp",
  "MegaCorp",
  "KuaiGong International",
  "Four Sigma",
  "NWO",
  "Blade Industries",
  "OmniTek Incorporated",
  "Bachman & Associates",
  "Clarke Incorporated",
  "Fulcrum Technologies",
];

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  
  // 🏁 Logger-Instanz für dieses Subsystem initialisieren
  const logger = new Logger(ns, "SLEEVE", "INFO");
  logger.info("🦾 Sleeve-Subsystem aktiv. Kontrolliere Klone...");

  const BUDGET_MULTIPLIER = 10;

  while (true) {
    if (ns.sleeve === undefined) {
      logger.error("🛑 Keine Sleeve-API (SF10) in diesem Node verfügbar.");
      return;
    }

    const numSleeves = ns.sleeve.getNumSleeves();
    const p = ns.getPlayer();
    const currentState = loadState(ns);
    const ownedAugs = ns.singularity.getOwnedAugmentations(true);

    // ======================================================================
    // 1. RUF-EVALUIERUNG FÜR FACTION-GRIND
    // ======================================================================
    const factionsNeedingRep: FactionName[] = [];

    for (const faction of p.factions) {
      let maxRepNeeded = 0;
      try {
        const augs = ns.singularity.getAugmentationsFromFaction(faction);
        for (const aug of augs) {
          if (aug !== "NeuroFlux Governor" && !ownedAugs.includes(aug)) {
            const req = ns.singularity.getAugmentationRepReq(aug);
            if (req > maxRepNeeded) maxRepNeeded = req;
          }
        }
      } catch {
        continue;
      }

      const currentRep = ns.singularity.getFactionRep(faction);
      if (currentRep < maxRepNeeded) {
        factionsNeedingRep.push(faction as FactionName);
      }
    }

    // ======================================================================
    // 2. PRE-SCAN: WELCHE FRAKTIONEN SIND BEREITS BESETZT?
    // ======================================================================
    const occupiedFactions: FactionName[] = [];
    for (let i = 0; i < numSleeves; i++) {
      const task = ns.sleeve.getTask(i);
      const stats = ns.sleeve.getSleeve(i);
      if (stats.shock === 0 && stats.sync === 100 && task?.type === "FACTION") {
        const fName = (task as any).factionName as FactionName;
        if (
          factionsNeedingRep.includes(fName) &&
          !occupiedFactions.includes(fName)
        ) {
          occupiedFactions.push(fName);
        }
      }
    }

    // ======================================================================
    // 3. MANAGEMENT JEDES EINZELNEN SLEEVES
    // ======================================================================
    for (let i = 0; i < numSleeves; i++) {
      const stats = ns.sleeve.getSleeve(i);
      const currentTask = ns.sleeve.getTask(i);

      // --- PHASE 1: SCHOCK-ABBAU ---
      if (stats.shock > 0) {
        if (currentTask?.type !== "RECOVERY") {
          ns.sleeve.setToShockRecovery(i);
          logger.info(`💔 Klon #${i} geht in die Schock-Therapie.`);
        }
        continue;
      }

      // --- PHASE 2: SYNCHRONISATION ---
      if (stats.sync < 100) {
        if (currentTask?.type !== "SYNCHRO") {
          ns.sleeve.setToSynchronize(i);
          logger.info(`⚡ Klon #${i} startet Gehirn-Synchronisation.`);
        }
        continue;
      }

      // --- PHASE 3: AUTOMATISCHES AUGMENT-SHOPPING ---
      try {
        const purchasableAugs = ns.sleeve.getSleevePurchasableAugs(i);
        purchasableAugs.sort((a, b) => a.cost - b.cost);

        if (purchasableAugs.length > 0) {
          const cheapestAug = purchasableAugs[0];
          if (ns.getPlayer().money > cheapestAug.cost * BUDGET_MULTIPLIER) {
            if (ns.sleeve.purchaseSleeveAug(i, cheapestAug.name)) {
              logger.success(`🛒 Klon #${i}: Augment erworben -> ${cheapestAug.name}`);
            }
          }
        }
      } catch {
        /* Failsafe */
      }

      // --- PHASE 4: STRATEGISCHE ARBEITSZUTEILUNG ---
      if (factionsNeedingRep.length > 0) {
        let targetFaction: FactionName | null = null;

        if (currentTask?.type === "FACTION") {
          const currentFaction = (currentTask as any)
            .factionName as FactionName;
          if (factionsNeedingRep.includes(currentFaction)) {
            targetFaction = currentFaction;
          }
        }

        if (!targetFaction) {
          const availableFactions = factionsNeedingRep.filter(
            (f) => !occupiedFactions.includes(f),
          );

          if (availableFactions.length > 0) {
            if (
              i === 0 &&
              currentState?.targetFaction &&
              availableFactions.includes(
                currentState.targetFaction as FactionName,
              )
            ) {
              targetFaction = currentState.targetFaction as FactionName;
            } else {
              targetFaction = availableFactions[0];
            }
          }
        }

        if (targetFaction) {
          if (
            currentTask?.type === "FACTION" &&
            (currentTask as any).factionName === targetFaction
          ) {
            continue;
          }

          const workTypes = [
            "hacking",
            "field",
            "security",
          ] as unknown as FactionWorkType[];
          let assigned = false;
          for (const work of workTypes) {
            if (ns.sleeve.setToFactionWork(i, targetFaction, work)) {
              assigned = true;
              logger.info(`🤝 Klon #${i} arbeitet nun für Faction '${targetFaction}' (${work}).`);
              if (!occupiedFactions.includes(targetFaction)) {
                occupiedFactions.push(targetFaction);
              }
              break;
            }
          }
          if (assigned) continue;
        }
      }

      // 🥈 PRIO 2: Unternehmens-Dienst & Uni-Push
      if (p.skills.hacking >= 250) {
        const employedCorps = Object.keys(p.jobs).filter((job) =>
          MEGACORPS.includes(job),
        ) as CompanyName[];

        if (employedCorps.length > 0) {
          const targetCorp = employedCorps[i % employedCorps.length];
          const currentCompanyRep = ns.singularity.getCompanyRep(targetCorp);
          const requiredRep = targetCorp === "Fulcrum Technologies" ? 400_000 : 200_000;

          if (currentCompanyRep < requiredRep) {
            const targetStatThreshold = 300;
            const targetCity = p.city === "Volhaven" ? "Volhaven" : "Sector-12";
            const bestUniversity = targetCity === "Volhaven" ? "ZB Institute of Technology" : "Rothman University";

            // ✈️ REISE-LOGIK HINZUGEFÜGT
            if (p.skills.hacking < targetStatThreshold || p.skills.charisma < targetStatThreshold) {
              if (stats.city !== targetCity) {
                if (ns.getPlayer().money >= 200_000) {
                  if (ns.sleeve.travel(i, targetCity)) {
                    logger.info(`✈️ Klon #${i} reist von ${stats.city} nach ${targetCity} für die Universität.`);
                    stats.city = targetCity;
                  }
                } else {
                  logger.warn(`⚠️ Klon #${i}: Geldmangel ($200k benötigt) für Reise nach ${targetCity}.`);
                }
              }
            }

            // A) HACKING-Defizit des CHARAKTERS ausgleichen
            if (p.skills.hacking < targetStatThreshold) {
              if (currentTask?.type === "CLASS" && (currentTask as any).classType === "Algorithms") {
                continue;
              }
              if (stats.city === targetCity) {
                ns.sleeve.setToUniversityCourse(i, bestUniversity, "Algorithms");
                logger.info(`🎓 Klon #${i} lernt Algorithms an der ${bestUniversity}.`);
              }
              continue;
            }

            // B) CHARISMA-Defizit des CHARAKTERS ausgleichen
            else if (p.skills.charisma < targetStatThreshold) {
              if (currentTask?.type === "CLASS" && (currentTask as any).classType === "Leadership") {
                continue;
              }
              if (stats.city === targetCity) {
                ns.sleeve.setToUniversityCourse(i, bestUniversity, "Leadership");
                logger.info(`🎓 Klon #${i} lernt Leadership an der ${bestUniversity}.`);
              }
              continue;
            }

            // C) Charakter-Stats sind bereit -> Sleeve farmt Firmen-Ruf
            else {
              if (currentTask?.type === "COMPANY" && (currentTask as any).companyName === targetCorp) {
                continue;
              }
              if (ns.sleeve.setToCompanyWork(i, targetCorp)) {
                logger.info(`🏢 Klon #${i} farmt jetzt Ruf bei ${targetCorp}.`);
                continue;
              }
            }
          }
        }
      }

      // 🥉 PRIO 3: Fallback-Kriminalität
      const targetCrime = ns.heart.break() > -22 || p.numPeopleKilled < 30 ? "Homicide" : "Mug";

      if (currentTask?.type === "CRIME" && (currentTask as any).crimeType === targetCrime) {
        continue;
      }

      ns.sleeve.setToCommitCrime(i, targetCrime);
      logger.warn(`🔫 Klon #${i} wechselt auf Fallback-Kriminalität: ${targetCrime}`);
    }

    // ======================================================================
    // 4. 📊 MONITOR-DASHBOARD (LOG-AUSGABE)
    // ======================================================================
    ns.clearLog();
    ns.print("╔════════╤═════════╤═════════╤════════════════════════════════════════════════╗");
    ns.print("║ Sleeve │ Schock  │ Sync    │ Aktuelle Beschäftigung                         ║");
    ns.print("╠════════╪═════════╪═════════╪════════════════════════════════════════════════╣");

    for (let i = 0; i < numSleeves; i++) {
      const stats = ns.sleeve.getSleeve(i);
      const task = ns.sleeve.getTask(i);

      const idStr = `#${i}`.padEnd(6);
      const shockStr = `${stats.shock.toFixed(1)}%`.padEnd(7);
      const syncStr = `${stats.sync.toFixed(1)}%`.padEnd(7);

      let taskDesc = "IDLE";
      if (task) {
        switch (task.type) {
          case "RECOVERY":     taskDesc = "💔 Recovery (Schock abbauen)"; break;
          case "SYNCHRO":      taskDesc = "⚡ Synchronize (Sync erhöhen)"; break;
          case "FACTION":      taskDesc = `🤝 Faction: ${(task as any).factionName}`; break;
          case "COMPANY":      taskDesc = `🏢 Company: ${(task as any).companyName}`; break;
          case "CRIME":        taskDesc = `🔫 Crime: ${(task as any).crimeType}`; break;
          case "BLADEBURNER":  taskDesc = "⚔️ Bladeburner Operation"; break;
          case "CLASS":        taskDesc = `🎓 Class: ${(task as any).classType}`; break;
          default:             taskDesc = `⚙️ ${task.type}`;
        }
      }

      const taskStr = taskDesc.padEnd(46);
      ns.print(`║ ${idStr} │ ${shockStr} │ ${syncStr} │ ${taskStr} ║`);
    }
    ns.print("╚════════╧═════════╧═════════╧════════════════════════════════════════════════╝");

    // 📜 Dynamischer Tail-View: Die letzten 6 Zeilen direkt aus der Logdatei lesen
    try {
      const logFileContent = ns.read("/logs/bitos_system.txt");
      if (logFileContent) {
        const lines = logFileContent.split("\n");
        // Nur Einträge filtern, die von diesem Subsystem [SLEEVE] stammen
        const sleeveLines = lines.filter(line => line.includes("[SLEEVE]")).slice(-6);
        
        if (sleeveLines.length > 0) {
          ns.print("\n📜 Aktuelle System-Ereignisse (Log):");
          for (const line of sleeveLines) {
            ns.print(line);
          }
        }
      }
    } catch {
      /* Failsafe falls Datei blockiert */
    }

    await ns.sleep(2000);
  }
}