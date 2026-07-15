import { NS } from "@ns";
import { Logger } from "../core/logger.js"; // 🟢 Pfad vereinfacht!

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const currentHost = ns.getHostname();
  if (currentHost === "home") return;

  const logger = new Logger(
    ns,
    `LOOT-${currentHost}`,
    "INFO",
    "/logs/dnet_system.txt",
  );
  let totalSuckedCaches = 0;

  const nearbyServers = ns.dnet.probe();
  for (const host of nearbyServers) {
    if (host === "home" || host === currentHost) continue;

    try {
      const details = ns.dnet.getServerDetails(host) as any;
      if (details && details.hasSession) {
        const remoteCaches = ns.ls(host, ".cache");
        if (remoteCaches.length > 0) {
          totalSuckedCaches += remoteCaches.length;
          ns.scp(remoteCaches, currentHost, host);
          for (const file of remoteCaches) {
            ns.rm(file, host);
          }
        }
      }
    } catch (e) {
      /* Failsafe */
    }
  }

  if (totalSuckedCaches > 0) {
    logger.info(`🌪️ ${totalSuckedCaches} Caches von Satelliten abgesaugt.`);
  }

  const files = ns.ls(currentHost, ".cache");
  if (files.length > 0) {
    logger.success(`💰 Verarbeite ${files.length} lokale Caches auf ${currentHost}.`);
  }

  for (const file of files) {
    try {
      const result = ns.dnet.openCache(file) as any;
      if (result && result.success) {
        const potentialPw = result.data || result.message;
        if (typeof potentialPw === "string") {
          const cleanPw = potentialPw.includes(":")
            ? potentialPw.split(":").pop()?.trim()
            : potentialPw.trim();
          if (cleanPw) {
            ns.write("/passwords.txt", `\n${cleanPw}`, "a");
            ns.writePort(5, `${currentHost}:${cleanPw}`);
          }
        }
        ns.rm(file, currentHost);
      }
    } catch (e) {
      /* Failsafe */
    }
  }
}