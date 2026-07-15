import { NS, FactionName } from "@ns";
import { loadState } from "./state-manager.js";
import { Logger } from "./logger.js";
import { getFactionsNeedingRep, manageAllSleeves } from "../lib/sleeve-manager.js"; // 🟢 Ausgelagert
import { printSleeveDashboard } from "../lib/sleeve-ui.js";                       // 🟢 Ausgelagert

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const logger = new Logger(ns, "SLEEVE", "INFO", "/logs/sleeve.txt");
  logger.info("🦾 Sleeve-Subsystem aktiv. Kontrolliere Klone...");

  // Cache für Fraktions-Ruf-Abfragen (Throttling)
  let factionsNeedingRep: FactionName[] = [];
  let lastFactionScan = 0;
  const SCAN_INTERVAL = 30000; // Nur alle 30 Sekunden scannen

  const localLogBuffer: string[] = [];
  function addLocalLog(msg: string) {
    localLogBuffer.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (localLogBuffer.length > 5) localLogBuffer.shift(); // Nur die letzten 5 behalten
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

    // ======================================================================
    // 1. RUF-EVALUIERUNG (MIT THROTTLING)
    // ======================================================================
    if (
      Date.now() - lastFactionScan > SCAN_INTERVAL ||
      factionsNeedingRep.length === 0
    ) {
      factionsNeedingRep = getFactionsNeedingRep(ns, p.factions, ownedAugs);
      lastFactionScan = Date.now();
    }

    // ======================================================================
    // 2. STRATEGISCHE ARBEITSZUTEILUNG
    // ======================================================================
    manageAllSleeves(
      ns,
      p,
      currentState,
      ownedAugs,
      factionsNeedingRep,
      logger,
      addLocalLog
    );

    // ======================================================================
    // 3. UI DASHBOARD RENDERING
    // ======================================================================
    printSleeveDashboard(ns, numSleeves, localLogBuffer);

    await ns.sleep(2000);
  }
}