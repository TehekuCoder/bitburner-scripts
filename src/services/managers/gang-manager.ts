import { FactionName, NS } from "@ns";
import { manageGang } from "../../lib/utils/gang-utils.js";
import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";
import { loadBatcherState, patchGangState } from "/infrastructure/state/state.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const logger = new Logger(ns, "GANG");

  if (!ns.gang.inGang()) {
    logger.error("🛑 Keine Gang vorhanden. Daemon beendet.");
    return;
  }

  logger.info("👥 Gang-Daemon gestartet (Headless).");

  const localLogBuffer: string[] = [];
  function addLocalLog(msg: string) {
    localLogBuffer.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (localLogBuffer.length > 5) localLogBuffer.shift();
  }

  while (true) {
    const batcherState = loadBatcherState(ns);
    const isBatcherActive = batcherState?.batcherActive ?? false;

    // 🔄 Gang verwalten & Entscheidungen ausführen
    const result = manageGang(ns, logger, addLocalLog, isBatcherActive);

    const info = ns.gang.getGangInformation();
    const members = ns.gang.getMemberNames();

    // 📊 State inklusive Logs und Gewinnchance für das UI sichern
    patchGangState(ns, {
      hasGang: true,
      gangFaction: info.faction as FactionName,
      isHackingGang: info.isHacking,
      gangMembersCount: members.length,
      gangRespect: info.respect,
      gangWantedPenalty: info.wantedPenalty,
      minWinChance: result?.minWinChance ?? 1,
      recentLogs: localLogBuffer,
    });

    await ns.sleep(3000);
  }
}