import { FactionName, NS } from "@ns";
import { manageGang } from "../lib/utils/gang-utils.js";
import { printGangDashboard } from "ui/gang-ui.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { patchGangState, loadBatcherState } from "/lib/state.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const logger = new Logger(ns, "GANG");

  if (!ns.gang.inGang()) {
    logger.error("🛑 Keine Gang vorhanden. Daemon beendet.");
    return;
  }

  ns.ui.openTail();
  ns.ui.setTailTitle("Zentrale Gang-Verwaltung");
  ns.ui.resizeTail(767, 340);

  logger.info("👥 Gang-Subsystem gestartet.");

  const localLogBuffer: string[] = [];
  function addLocalLog(msg: string) {
    localLogBuffer.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (localLogBuffer.length > 5) localLogBuffer.shift();
  }

  while (true) {
    // 📊 Batcher-Status aus dem zentralen State lesen
    const batcherState = loadBatcherState(ns);
    const isBatcherActive = batcherState?.batcherActive ?? false;

    // 📊 Gang State synchronisieren
    const info = ns.gang.getGangInformation();
    const members = ns.gang.getMemberNames();

    patchGangState(ns, {
      hasGang: true,
      gangFaction: info.faction as FactionName,
      isHackingGang: info.isHacking,
      gangMembersCount: members.length,
      gangRespect: info.respect,
      gangWantedPenalty: info.wantedPenalty,
    });

    // 🔄 batcherActive-Flag an manageGang übergeben
    const result = manageGang(ns, logger, addLocalLog, isBatcherActive);

    if (result) {
      const { gangInfo, members, minWinChance } = result;
      printGangDashboard(ns, gangInfo, members, minWinChance, localLogBuffer);
    }

    await ns.sleep(3000); 
  }
}