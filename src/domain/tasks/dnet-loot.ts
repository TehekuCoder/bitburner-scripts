import { NS } from "@ns";
import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const currentHost = ns.getHostname();
  if (currentHost === "home") return;

  const logger = new Logger(ns, `LOOT-${currentHost}`);
  let totalSuckedCaches = 0;

  const nearbyServers = ns.dnet.probe();
  for (const host of nearbyServers) {
    if (host === "home" || host === currentHost) continue;

    try {
      const details = ns.dnet.getServerDetails(host) as any;
      if (details?.hasSession) {
        const remoteCaches = ns.ls(host, ".cache");
        if (remoteCaches.length > 0) {
          totalSuckedCaches += remoteCaches.length;
          ns.scp(remoteCaches, currentHost, host);
          for (const file of remoteCaches) {
            ns.rm(file, host);
          }
        }
      }
    } catch {}
  }

  if (totalSuckedCaches > 0) {
    logger.info(`🌪️ ${totalSuckedCaches} Caches von Nachbarn abgesaugt.`);
  }

  const files = ns.ls(currentHost, ".cache");
  if (files.length === 0) return;

  logger.success(`💰 Verarbeite ${files.length} lokale Caches auf ${currentHost}.`);

  for (const file of files) {
    try {
      const result = ns.dnet.openCache(file) as any;
      if (result?.success) {
        const rawData = result.data || result.message;
        if (typeof rawData === "string") {
          const cleanPw = rawData.includes(":") ? rawData.split(":").pop()?.trim() : rawData.trim();
          if (cleanPw) {
            ns.write("/passwords.txt", `${cleanPw}\n`, "a");
            ns.writePort(5, JSON.stringify({ host: currentHost, password: cleanPw }));
          }
        }
        ns.rm(file, currentHost);
      }
    } catch {}
  }
}