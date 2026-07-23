// sys-sleeve.ts

import { NS, FactionName } from "@ns";
import { loadState, patchState } from "./state-manager.js";
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
  ns.ui.resizeTail(767, 298);

  const logger = new Logger(ns, "SLEEVE", "INFO", "/logs/sleeve.txt");
  logger.info("🦾 Sleeve-Subsystem aktiv. Kontrolliere Klone...");

  let factionsNeedingRep: FactionName[] = [];
  let lastFactionScan = 0;
  let lastStateProgress = "";
  const SCAN_INTERVAL = 30000;

  const localLogBuffer: string[] = [];
  function addLocalLog(msg: string) {
    localLogBuffer.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (localLogBuffer.length > 5) localLogBuffer.shift();
  }

  while (true) {
    // 🛡️ API CHECK 1: Sleeves (SF10)
    if (ns.sleeve === undefined) {
      logger.error("🛑 Keine Sleeve-API (SF10) in diesem Node verfügbar.");
      return;
    }

    const numSleeves = ns.sleeve.getNumSleeves();
    if (numSleeves === 0) {
      logger.warn("⚠️ Keine Sleeves im Besitz.");
      await ns.sleep(10000);
      continue;
    }

    const p = ns.getPlayer();
    const loaded = loadState(ns);
    const currentState = loaded ?? {
      strategy: "MONEY",
      progressBar: "Init...",
      batcherProgress: "Inaktiv",
      batcherActive: false,
      financeProgress: "Inaktiv",
      traderProgress: "Inaktiv",
      hacknetProgress: "Inaktiv",
      sleeveProgress: "Inaktiv",
      currentBitNode: 1,
      currentBitNodeLevel: 1,
      sourceFiles: {},
      hasDarkScapeNavigator: false,
      hasTorRouter: false,
      hasGang: false,
      hasCorporation: false,
      hasBladeburner: false,
      sources: {},
      lastUpdate: Date.now(),
      playerHacking: p.skills.hacking,
    };

    // 🛡️ API CHECK 2: Singularity (SF4) für getOwnedAugmentations
    let ownedAugs: string[] = [];
    if (ns.singularity !== undefined) {
      ownedAugs = ns.singularity.getOwnedAugmentations(true);
    }

    // Faction-Scan Intervall
    if (
      Date.now() - lastFactionScan > SCAN_INTERVAL ||
      factionsNeedingRep.length === 0
    ) {
      factionsNeedingRep = getFactionsNeedingRep(ns, p.factions, ownedAugs);
      lastFactionScan = Date.now();
    }

    // 1. Zuweisung & Berechnung
    manageAllSleeves(
      ns,
      p,
      currentState,
      ownedAugs,
      factionsNeedingRep,
      logger,
      addLocalLog,
    );

    // 2. Nur patchen, wenn sich der Fortschritt verändert hat
    if (
      currentState.sleeveProgress &&
      currentState.sleeveProgress !== lastStateProgress
    ) {
      patchState(ns, { sleeveProgress: currentState.sleeveProgress });
      lastStateProgress = currentState.sleeveProgress;
    }

    // 3. Dashboard rendern
    printSleeveDashboard(ns, numSleeves, localLogBuffer);

    await ns.sleep(2000);
  }
}