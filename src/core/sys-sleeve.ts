// sys-sleeve.ts

import { NS, FactionName } from "@ns";
import { loadState, patchState } from "./state-manager.js"; // 🟢 patchState importiert
import { Logger } from "./logger.js";
import {
  getFactionsNeedingRep,
  manageAllSleeves,
} from "../lib/sleeve-manager.js";
import { printSleeveDashboard } from "../lib/sleeve-ui.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  ns.ui.openTail();

  ns.ui.setTailTitle("Zentrale Sleeve-Verwaltung");

  ns.ui.resizeTail(767,298);

  const logger = new Logger(ns, "SLEEVE", "INFO", "/logs/sleeve.txt");
  logger.info("🦾 Sleeve-Subsystem aktiv. Kontrolliere Klone...");

  let factionsNeedingRep: FactionName[] = [];
  let lastFactionScan = 0;
  const SCAN_INTERVAL = 30000;

  const localLogBuffer: string[] = [];
  function addLocalLog(msg: string) {
    localLogBuffer.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (localLogBuffer.length > 5) localLogBuffer.shift();
  }

  while (true) {
    if (ns.sleeve === undefined) {
      logger.error("🛑 Keine Sleeve-API (SF10) in diesem Node verfügbar.");
      return;
    }

    const numSleeves = ns.sleeve.getNumSleeves();
    const p = ns.getPlayer();
    const currentState = loadState(ns);
    const ownedAugs = ns.singularity.getOwnedAugmentations(true);

    if (
      Date.now() - lastFactionScan > SCAN_INTERVAL ||
      factionsNeedingRep.length === 0
    ) {
      factionsNeedingRep = getFactionsNeedingRep(ns, p.factions, ownedAugs);
      lastFactionScan = Date.now();
    }

    // 1. Zuweisung & Berechnung (verändert das lokale currentState-Objekt)
    manageAllSleeves(
      ns,
      p,
      currentState,
      ownedAugs,
      factionsNeedingRep,
      logger,
      addLocalLog,
    );

    // 🟢 NEU: Schreibe den berechneten Fortschritt aktiv zurück in das System-State!
    if (currentState && currentState.sleeveProgress) {
      patchState(ns, { sleeveProgress: currentState.sleeveProgress });
    }

    printSleeveDashboard(ns, numSleeves, localLogBuffer);

    await ns.sleep(2000);
  }
}
