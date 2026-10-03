import { NS } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const currentHost = ns.getHostname();
  const logger = new LoggerClient(ns, `PHISH-${currentHost}`);

  try {
    const reallocation = await ns.dnet.memoryReallocation(currentHost);
    if (!reallocation.success) {
      logger.warn(
        `RAM-Reallokation auf ${currentHost} nicht erfolgreich: ${reallocation.message}`,
      );
    }

    const result = await ns.dnet.phishingAttack();
    if (!result.success) {
      logger.warn(`Phishing auf ${currentHost} fehlgeschlagen: ${result.message}`);
    } else {
      logger.success(`Phishing auf ${currentHost} erfolgreich.`);
    }
  } catch (error) {
    logger.error(`Darknet-Phishing auf ${currentHost} fehlgeschlagen: ${String(error)}`);
  }
}