import { NS, FactionName, FactionWorkType, CompanyName } from "@ns";
import { loadState } from "./state-manager.js";

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
  //ns.ui.openTail(); // Optional: Aktivieren, wenn sich das Fenster beim Start direkt öffnen soll
  ns.print("🦾 Sleeve-Subsystem aktiv. Kontrolliere Klone...");

  const BUDGET_MULTIPLIER = 10;

  while (true) {
    if (ns.sleeve === undefined) {
      ns.print("🛑 [Sleeve] Keine Sleeve-API (SF10) in diesem Node verfügbar.");
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
        }
        continue;
      }

      // --- PHASE 2: SYNCHRONISATION ---
      if (stats.sync < 100) {
        if (currentTask?.type !== "SYNCHRO") {
          ns.sleeve.setToSynchronize(i);
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
              ns.print(
                `🛒 [Sleeve ${i}] Augment erworben: ${cheapestAug.name}`,
              );
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
              if (!occupiedFactions.includes(targetFaction)) {
                occupiedFactions.push(targetFaction);
              }
              break;
            }
          }
          if (assigned) continue;
        }
      }

      // 🥈 PRIO 2: Unternehmens-Dienst (Optimiert mit Charakter-Stat-Check & EP-Sharing)
      if (p.skills.hacking >= 250) {
        const employedCorps = Object.keys(p.jobs).filter((job) =>
          MEGACORPS.includes(job),
        ) as CompanyName[];

        if (employedCorps.length > 0) {
          const targetCorp = employedCorps[i % employedCorps.length];

          // 1. Ruf evaluieren
          const currentCompanyRep = ns.singularity.getCompanyRep(targetCorp);
          const requiredRep =
            targetCorp === "Fulcrum Technologies" ? 400_000 : 200_000;

          // Nur aktiv werden, wenn die Fraktion-Einladung noch aussteht
          if (currentCompanyRep < requiredRep) {
            // Dein gewünschter Schwellenwert für die Charakter-Beförderung
            const targetStatThreshold = 300;

            // "ZB Institute of Technology" löst den TypeScript-Fehler für Volhaven auf
            const bestUniversity =
              p.city === "Volhaven"
                ? "ZB Institute of Technology"
                : "Rothman University";

            // A) HACKING-Defizit des CHARAKTERS ausgleichen
            if (p.skills.hacking < targetStatThreshold) {
              if (
                currentTask?.type === "CLASS" &&
                (currentTask as any).classType === "Algorithms"
              ) {
                continue;
              }
              ns.sleeve.setToUniversityCourse(i, bestUniversity, "Algorithms");
              ns.print(
                `🎓 [Sleeve ${i}] Pusht Hacking für Charakter an der ${bestUniversity}`,
              );
              continue;
            }

            // B) CHARISMA-Defizit des CHARAKTERS ausgleichen
            else if (p.skills.charisma < targetStatThreshold) {
              if (
                currentTask?.type === "CLASS" &&
                (currentTask as any).classType === "Leadership"
              ) {
                continue;
              }
              ns.sleeve.setToUniversityCourse(i, bestUniversity, "Leadership");
              ns.print(
                `🎓 [Sleeve ${i}] Pusht Charisma für Charakter an der ${bestUniversity}`,
              );
              continue;
            }

            // C) Charakter-Stats sind bereit -> Sleeve farmt Firmen-Ruf
            else {
              if (
                currentTask?.type === "COMPANY" &&
                (currentTask as any).companyName === targetCorp
              ) {
                continue;
              }
              if (ns.sleeve.setToCompanyWork(i, targetCorp)) {
                ns.print(
                  `🏢 [Sleeve ${i}] Arbeitet bei ${targetCorp} (Ruf: ${ns.format.number(currentCompanyRep)}/${ns.format.number(requiredRep)})`,
                );
                continue;
              }
            }
          } else {
            ns.print(`✅ [Sleeve ${i}] Zielruf für ${targetCorp} erreicht.`);
          }
        }
      }

      // 🥉 PRIO 3: Fallback-Kriminalität
      const targetCrime =
        ns.heart.break() > -22 || p.numPeopleKilled < 30 ? "Homicide" : "Mug";

      if (
        currentTask?.type === "CRIME" &&
        (currentTask as any).crimeType === targetCrime
      ) {
        continue;
      }

      ns.sleeve.setToCommitCrime(i, targetCrime);
    }

    // ======================================================================
    // 4. 📊 MONITOR-DASHBOARD (LOG-AUSGABE)
    // ======================================================================
    ns.clearLog();
    ns.print(
      "╔════════╤═════════╤═════════╤════════════════════════════════════════════════╗",
    );
    ns.print(
      "║ Sleeve │ Schock  │ Sync    │ Aktuelle Beschäftigung                         ║",
    );
    ns.print(
      "╠════════╪═════════╪═════════╪════════════════════════════════════════════════╣",
    );

    for (let i = 0; i < numSleeves; i++) {
      const stats = ns.sleeve.getSleeve(i);
      const task = ns.sleeve.getTask(i);

      const idStr = `#${i}`.padEnd(6);
      const shockStr = `${stats.shock.toFixed(1)}%`.padEnd(7);
      const syncStr = `${stats.sync.toFixed(1)}%`.padEnd(7);

      let taskDesc = "IDLE";
      if (task) {
        switch (task.type) {
          case "RECOVERY":
            taskDesc = "💔 Recovery (Schock abbauen)";
            break;
          case "SYNCHRO":
            taskDesc = "⚡ Synchronize (Sync erhöhen)";
            break;
          case "FACTION":
            taskDesc = `🤝 Faction: ${(task as any).factionName}`;
            break;
          case "COMPANY":
            taskDesc = `🏢 Company: ${(task as any).companyName}`;
            break;
          case "CRIME":
            taskDesc = ` 🔫 Crime: ${(task as any).crimeType}`;
            break;
          case "BLADEBURNER":
            taskDesc = "⚔️ Bladeburner Operation";
            break;
          case "CLASS":
            taskDesc = `🎓 Class: ${(task as any).classType}`;
            break;
          default:
            taskDesc = `⚙️ ${task.type}`;
        }
      }

      const taskStr = taskDesc.padEnd(46);
      ns.print(`║ ${idStr} │ ${shockStr} │ ${syncStr} │ ${taskStr} ║`);
    }
    ns.print(
      "╚════════╧═════════╧═════════╧════════════════════════════════════════════════╝",
    );

    await ns.sleep(2000); // Intervall auf 2 Sekunden verkürzt für flüssigere Updates
  }
}
