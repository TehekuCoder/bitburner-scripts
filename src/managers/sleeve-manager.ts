import { NS, FactionName } from "@ns";
import { getFactionsNeedingRep, manageAllSleeves } from "/lib/sleeve-utils.js";
import { printSleeveDashboard } from "ui/sleeve-ui.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { loadSleeveState, patchSleeveState } from "/lib/state.js";
import { SleeveOptions, SleeveMode } from "/lib/types/sleeves.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  ns.ui.openTail();
  ns.ui.setTailTitle("Zentrale Sleeve-Verwaltung");
  ns.ui.resizeTail(767, 298);

  const logger = new Logger(ns, "SLEEVE");
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

    const botState = loadSleeveState(ns);
    const options: SleeveOptions = {
      globalMode: botState?.sleeveGlobalMode as SleeveMode | undefined,
      targetFaction: botState?.targetFaction,
      targetStat: botState?.targetStat,
      strategy: botState?.strategy,
    };

    let ownedAugs: string[] = [];
    if (ns.singularity !== undefined) {
      ownedAugs = ns.singularity.getOwnedAugmentations(true);
    }

    // Fix: Scan-Intervall greift jetzt verlässlich alle 30s (auch wenn das Array leer ist)
    if (
      lastFactionScan === 0 ||
      Date.now() - lastFactionScan > SCAN_INTERVAL
    ) {
      factionsNeedingRep = getFactionsNeedingRep(ns, p.factions, ownedAugs);
      lastFactionScan = Date.now();
    }

    const currentProgress = manageAllSleeves(
      ns,
      p,
      options,
      ownedAugs,
      factionsNeedingRep,
      logger,
      addLocalLog,
    );

    if (currentProgress && currentProgress !== lastStateProgress) {
      patchSleeveState(ns, { sleeveProgress: currentProgress });
      lastStateProgress = currentProgress;
    }

    printSleeveDashboard(ns, numSleeves, localLogBuffer);

    await ns.sleep(2000);
  }
}