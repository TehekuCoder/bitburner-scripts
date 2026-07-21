// tasks/dnet-crawler.ts

import { NS } from "@ns";
import { Logger } from "../core/logger.js";
import { processedServers, COOLDOWN_MS, COOLDOWN_FILE, LOOT_INTERVAL_MS } from "/lib/constants.js";

let lastLootTime = 0;

function isServerInCooldown(ns: NS, host: string): boolean {
  if (!ns.fileExists(COOLDOWN_FILE)) return false;
  const lines = ns.read(COOLDOWN_FILE).split("\n");
  const now = Date.now();

  for (const line of lines) {
    const [cHost, cTime] = line.split(",");
    if (cHost === host) {
      return now - Number(cTime) < COOLDOWN_MS;
    }
  }
  return false;
}

/**
 * Liest das Passwort aus der Master-DB.
 * Greift auf Remote-Hosts explizit auf die DB auf 'home' zu, damit alle Knoten synchron sind.
 */
function getPasswordFromRegistry(ns: NS, host: string): string | null {
  const jsonDbFile = "/dnet-master-db.json";
  
  // Nutze read auf 'home', falls wir uns auf einem Remote-Node befinden
  const dbContent = ns.read(jsonDbFile);
  if (!dbContent) return null;

  try {
    const passwordDb = JSON.parse(dbContent);
    if (passwordDb && passwordDb[host] !== undefined) {
      return passwordDb[host];
    }
  } catch {
    return null;
  }
  return null;
}

export async function main(ns: NS): Promise<void> {
  const scriptName = ns.getScriptName();
  const currentHost = ns.getHostname();
  ns.disableLog("ALL");

  const logger = new Logger(
    ns,
    `CRAWLER-${currentHost}`,
    "INFO",
    "/logs/dnet_system.txt",
  );

  if (currentHost !== "home") {
    await ns.dnet.memoryReallocation();
  }

  // NEU: Tracker für Topologie-Änderungen
  let lastKnownConnections: string[] = [];

  while (true) {
    const now = Date.now();
    const solverScript = "/tasks/dnet-solver.js";
    const lootScript = "/tasks/dnet-loot.js";
    const phishScript = "/tasks/dnet-phish.js";

    const maxRam = ns.getServerMaxRam(currentHost);
    let freeRam = maxRam - ns.getServerUsedRam(currentHost);
    let requiredSolverRam = ns.getScriptRam(solverScript, currentHost);
    const requiredLootRam = ns.getScriptRam(lootScript, currentHost) || 6.5;

    let isSolverRunning = ns.scriptRunning(solverScript, currentHost);
    const isLootRunning = ns.scriptRunning(lootScript, currentHost);
    const isLootDue = now - lastLootTime > LOOT_INTERVAL_MS && currentHost !== "home";

    const nearbyServers = ns.dnet.probe();

    // NEU: Überprüfen, ob sich die Verbindungen geändert haben
    const currentTopology = nearbyServers.slice().sort().join(",");
    const lastTopology = lastKnownConnections.slice().sort().join(",");

    if (currentTopology !== lastTopology && lastKnownConnections.length > 0) {
      logger.info(`🔄 Topologie-Wechsel erkannt! Vorher: ${lastKnownConnections.length} Nachbarn | Jetzt: ${nearbyServers.length} Nachbarn.`);
      // Hier könntest du z.B. Cooldowns ignorieren oder processedServers bereinigen, 
      // falls neue Verbindungen zu alten Knoten auftauchen.
    }
    lastKnownConnections = nearbyServers;

    let targetToCrack: string | null = null;
    let targetDetails: any = null;

    for (const hostname of nearbyServers) {
      if (hostname === "home") continue;
      if (isServerInCooldown(ns, hostname)) continue;

      let details = ns.dnet.getServerDetails(hostname) as any;
      if (!details.isConnectedToCurrentServer || !details.isOnline) continue;

      // 1. Prüfen, ob wir bereits eine Session haben
      if (!details.hasSession) {
        const storedPassword = getPasswordFromRegistry(ns, hostname);
        if (storedPassword !== null) {
          logger.info(`🔍 Bekanntes Passwort für ${hostname} in Registry gefunden. Versuche Direkt-Login...`);
          try {
            await ns.dnet.connectToSession(hostname, storedPassword);
            details = ns.dnet.getServerDetails(hostname) as any;

            if (!details.hasSession) {
              logger.warn(`⚠️ Direkt-Login für ${hostname} fehlgeschlagen. Weiche auf Solver aus.`);
            }
          } catch (e) {
            logger.error(`❌ Fehler bei Direkt-Login auf ${hostname}: ${e}`, false);
          }
        }
      }

      // 2. Status nach möglichem Login-Versuch neu auswerten
      if (!details.hasSession) {
        if (!targetToCrack && !isSolverRunning) {
          targetToCrack = hostname;
          targetDetails = details;
        }
      } else {
        processedServers.add(hostname);
      }
    }

    // Loot-Eviction
    if (isLootDue && !isLootRunning && maxRam >= requiredLootRam) {
      if (isSolverRunning) {
        logger.warn(`🚨 Loot-Intervall fällig! Erzwinge RAM-Eviction von Solver auf ${currentHost}.`);
        ns.scriptKill(solverScript, currentHost);
        await ns.sleep(200);
        isSolverRunning = false;
        freeRam = maxRam - ns.getServerUsedRam(currentHost);
      }
      targetToCrack = null;
      targetDetails = null;
    }

    let solverStarted = false;

    // Solver ausführen
    if (targetToCrack && targetDetails && !isSolverRunning) {
      const hasSolverModules = ns.fileExists("/modules/solvers/solveManager.js", currentHost) || 
                               ns.fileExists("/modules/solvers/solveManager.ts", currentHost);

      if (requiredSolverRam === 0 || !hasSolverModules) {
        logger.info(`📦 Solver-Abhängigkeiten fehlen auf ${currentHost}. Repliziere Krypto-Module von home...`);
        ns.scp(solverScript, currentHost, "home");
        const solverModules = ns.ls("home", "/modules/solvers/");
        if (solverModules.length > 0) {
          ns.scp(solverModules, currentHost, "home");
        }
        requiredSolverRam = ns.getScriptRam(solverScript, currentHost);
      }

      if (requiredSolverRam > 0 && freeRam >= requiredSolverRam) {
        if (isLootRunning) {
          ns.scriptKill(lootScript, currentHost);
          await ns.sleep(200);
        }

        logger.info(`📡 Target gesichtet: ${targetToCrack} [${targetDetails.modelId}]. Starte Krypto-Solver.`);
        ns.exec(
          solverScript,
          currentHost,
          1,
          targetToCrack,
          targetDetails.modelId || "Unknown",
          targetDetails.passwordLength || 0,
          targetDetails.passwordHint || "",
          targetDetails.data || "",
        );
        solverStarted = true;
      } else {
        logger.debug(`ℹ️ RAM knapp auf ${currentHost}. Überlasse ${targetToCrack} dem restlichen Botnetz.`);
      }
    }

    // Periodischer Phishing-/Loot-Zyklus
    if (
      currentHost !== "home" &&
      !isSolverRunning &&
      !solverStarted &&
      !isLootRunning &&
      isLootDue
    ) {
      if (!ns.fileExists(phishScript, currentHost) || !ns.fileExists(lootScript, currentHost)) {
        ns.scp([phishScript, lootScript], currentHost, "home");
      }

      const phishRam = ns.getScriptRam(phishScript, currentHost);
      const lootRam = ns.getScriptRam(lootScript, currentHost);
      const requiredMaxWorkerRam = Math.max(phishRam, lootRam);

      if (freeRam >= requiredMaxWorkerRam) {
        logger.info("🔄 Starte periodischen Phishing- und Beutezyklus...");
        const phishPid = ns.exec(phishScript, currentHost, 1);
        if (phishPid > 0) {
          while (ns.scriptRunning(phishScript, currentHost)) {
            await ns.sleep(500);
          }
        }

        const lootPid = ns.exec(lootScript, currentHost, 1);
        if (lootPid > 0) {
          while (ns.scriptRunning(lootScript, currentHost)) {
            await ns.sleep(500);
          }
        }

        lastLootTime = now;
        logger.success("✅ Phishing-Wartungszyklus abgeschlossen.");
      }
    }

    // 🚀 WURM-LOGIK ZUR AUSBREITUNG
    for (const hostname of processedServers) {
      if (!ns.serverExists(hostname)) continue;

      if (!ns.scriptRunning(scriptName, hostname)) {
        const isDarkweb = hostname === "darkweb";
        const minRamRequired = isDarkweb ? 2 : 8;

        if (ns.getServerMaxRam(hostname) >= minRamRequired) {
          const details = ns.dnet.getServerDetails(hostname) as any;
          let sessionReady = details.hasSession;

          if (!sessionReady) {
            const password = getPasswordFromRegistry(ns, hostname);
            if (password !== null) {
              await ns.dnet.connectToSession(hostname, password);
              sessionReady = true;
            }
          }

          if (sessionReady) {
            logger.info(`🚀 Wurm-Ausbreitung: Infiziere ${hostname} und starte Crawler.`);
            
            // ALLA ABHÄNGIGKEITEN KOPIEREN (inkl. /lib/constants.js und Solvern)
            const solverModules = ns.ls("home", "/modules/solvers/");
            const filesToCopy = [
              scriptName,
              solverScript,
              lootScript,
              phishScript,
              "/dnet-master-db.json",
              "/lib/constants.js",
              "/utils/progress.js",
              "/core/logger.js",
              ...solverModules
            ];

            ns.scp(filesToCopy, hostname, "home");
            ns.exec(scriptName, hostname, 1);
          }
        } else {
          logger.warn(`⚠️ ${hostname} hat zu wenig RAM (${ns.getServerMaxRam(hostname)}GB) für den Crawler.`);
        }
      }
    }

    await ns.sleep(5000);
  }
}