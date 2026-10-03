import { NS } from "@ns";
import { DNET_MASTER_PORT } from "/shared/constants/darknet.js";
import { DnetMasterMessage } from "/shared/types/network.js";
import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";
import { recordDnetPassword } from "/infrastructure/runtime/dnet-state.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const currentHost = ns.getHostname();
  if (currentHost === "home") return;

  const logger = new Logger(ns, `LOOT-${currentHost}`);
  let totalSuckedCaches = 0;

  for (const host of ns.dnet.probe()) {
    if (host === "home" || host === currentHost) continue;

    for (const file of ns.ls(host, ".cache")) {
      try {
        if (
          ns.scp(file, currentHost, host) &&
          ns.fileExists(file, currentHost)
        ) {
          ns.rm(file, host);
          totalSuckedCaches++;
        } else {
          logger.warn(`Cache ${file} konnte nicht sicher von ${host} übertragen werden.`);
        }
      } catch (error) {
        logger.warn(`Cache-Transfer von ${host} fehlgeschlagen: ${String(error)}`);
      }
    }
  }

  if (totalSuckedCaches > 0) {
    logger.info(`🌪️ ${totalSuckedCaches} Caches von Nachbarn übertragen.`);
  }

  const files = ns.ls(currentHost, ".cache");
  if (files.length === 0) return;

  logger.success(`💰 Verarbeite ${files.length} lokale Caches auf ${currentHost}.`);

  for (const file of files) {
    try {
      const result = ns.dnet.openCache(file);
      if (!result.success) {
        logger.warn(`Cache ${file} konnte nicht geöffnet werden: ${result.message}`);
        continue;
      }

      const rawData = result.message;
      const cleanPassword = rawData.includes(":")
        ? rawData.split(":").pop()?.trim()
        : rawData.trim();
      if (cleanPassword !== undefined) {
        recordDnetPassword(ns, currentHost, cleanPassword);
        const message: DnetMasterMessage = {
          type: "password",
          host: currentHost,
          password: cleanPassword,
        };
        if (!ns.tryWritePort(DNET_MASTER_PORT, JSON.stringify(message))) {
          logger.error(`Cache-Passwort für ${currentHost} konnte nicht an den DNet-Master übermittelt werden.`);
        }
      }
      ns.rm(file, currentHost);
    } catch (error) {
      logger.warn(`Cache ${file} konnte nicht verarbeitet werden: ${String(error)}`);
    }
  }
}
