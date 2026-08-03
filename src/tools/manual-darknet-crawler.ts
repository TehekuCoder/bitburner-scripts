import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";

const MAP_FILE = "/data/darknet-map.json";

interface NetworkMap {
  [hostname: string]: string[];
}

/**
 * Lädt die aktuelle Netzkarte (synchronisiert von home, falls remote).
 */
function loadMap(ns: NS): NetworkMap {
  const currentHost = ns.getHostname();
  
  if (currentHost !== "home" && ns.fileExists(MAP_FILE, "home")) {
    ns.scp(MAP_FILE, currentHost, "home");
  }

  if (!ns.fileExists(MAP_FILE)) return {};

  try {
    const content = ns.read(MAP_FILE);
    return content ? JSON.parse(content) : {};
  } catch {
    return {};
  }
}

/**
 * Speichert die Netzkarte lokal und kopiert sie direkt nach home.
 */
function saveMap(ns: NS, map: NetworkMap): void {
  const currentHost = ns.getHostname();
  const content = JSON.stringify(map, null, 2);

  ns.write(MAP_FILE, content, "w");

  if (currentHost !== "home") {
    ns.scp(MAP_FILE, "home", currentHost);
  }
}

export async function main(ns: NS): Promise<void> {
  const scriptName = ns.getScriptName();
  const currentHost = ns.getHostname();
  ns.disableLog("ALL");

  const logger = new Logger(ns, `MAPPER-${currentHost}`);

  // 1. Lokale Nachbarn ermitteln
  const neighbors: string[] = ns.dnet.probe();
  const map = loadMap(ns);

  // Topologie aktualisieren
  map[currentHost] = neighbors;
  saveMap(ns, map);

  logger.info(`🗺️ Node '${currentHost}' erfasst. Nachbarn: [${neighbors.join(", ")}]`);

  // 2. Rekursiv auf alle erreichbaren Nachbarn ausbreiten (Ebene 2, 3, etc.)
  for (const neighbor of neighbors) {
    if (neighbor === "home" || !ns.serverExists(neighbor)) continue;

    const details = ns.dnet.getServerDetails(neighbor) as any;
    
    // Bedingung: Server ist online und wir besitzen eine aktive Session
    if (details && details.isOnline !== false && details.hasSession) {
      if (!ns.scriptRunning(scriptName, neighbor)) {
        // Skript auf den Ziel-Server kopieren und starten
        ns.scp(scriptName, neighbor, "home");
        const pid = ns.exec(scriptName, neighbor, 1);
        
        if (pid > 0) {
          logger.info(`🚀 Topologie-Mapper auf '${neighbor}' gestartet.`);
        }
      }
    }
  }

  // Auf 'home' geben wir am Ende eine zusammenfassende Übersicht aus
  if (currentHost === "home") {
    await ns.sleep(1000); // Kurz warten, bis Remote-Ergebnisse synchronisiert sind
    const finalMap = loadMap(ns);
    const nodeCount = Object.keys(finalMap).length;
    
    logger.success(`✅ Darknet-Topologie erfolgreich aktualisiert! (${nodeCount} Server erfasst in ${MAP_FILE})`);
  }
}