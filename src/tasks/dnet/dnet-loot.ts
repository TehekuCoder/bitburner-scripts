import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const currentHost = ns.getHostname();

  if (currentHost === "home") return;

  // 🌪️ PHASE 1: DER BEUTE-STAUBSAUGER (Sauge Nachbarsatelliten leer)
  const nearbyServers = ns.dnet.probe();
  for (const host of nearbyServers) {
    if (host === "home" || host === currentHost) continue;

    try {
      const details = ns.dnet.getServerDetails(host) as any;
      // Nur absaugen, wenn wir eine aktive Session auf dem Target haben
      if (details && details.hasSession) {
        const remoteCaches = ns.ls(host, ".cache");
        if (remoteCaches.length > 0) {
          ns.print(`🌪️ Sauge ${remoteCaches.length} Caches von ${host} ab...`);
          
          // 1. Caches auf unseren aktuellen, starken Server evakuieren
          ns.scp(remoteCaches, currentHost, host);
          
          // 2. Auf dem fernen Server sofort löschen, damit nichts doppelt geholt wird
          for (const file of remoteCaches) {
            ns.rm(file, host);
          }
        }
      }
    } catch (e) {
      ns.print(`⚠️ Fehler beim Absaugen von ${host}: ${e}`);
    }
  }

  // 💰 PHASE 2: LOKALE VERARBEITUNG (Eigene + eingesaugte Caches)
  const files = ns.ls(currentHost, ".cache");
  if (files.length > 0) {
    ns.print(`💰 Verarbeite insgesamt ${files.length} Cache-Dateien...`);
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
      ns.print(`⚠️ Fehler beim Öffnen von Cache ${file}: ${e}`);
    }
  }
}