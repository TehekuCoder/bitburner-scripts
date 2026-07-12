import { NS } from "@ns";
import { Logger } from "../../core/logger.js"; // Pfad anpassen falls nötig

const processedServers = new Set<string>();
const COOLDOWN_FILE = "/dnet-cooldowns.txt";
const COOLDOWN_MS = 5 * 60 * 1000;
let lastLootTime = 0;
const LOOT_INTERVAL_MS = 3 * 60 * 1000;

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

function getPasswordFromRegistry(ns: NS, host: string): string | null {
  const jsonDbFile = "/dnet-master-db.json";
  if (!ns.fileExists(jsonDbFile)) return null;
  try {
    const passwordDb = JSON.parse(ns.read(jsonDbFile));
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

  // 🏁 Logger instanziieren (schreibt zentral nach /logs/dnet_system.txt)
  const logger = new Logger(
    ns,
    `CRAWLER-${currentHost}`,
    "INFO",
    "/logs/dnet_system.txt",
  );

  if (currentHost !== "home") {
    await ns.dnet.memoryReallocation();
  }

  while (true) {
    const now = Date.now();
    const solverScript = "/tasks/dnet/dnet-solver.js";
    const lootScript = "/tasks/dnet/dnet-loot.js";

    const maxRam = ns.getServerMaxRam(currentHost);
    let freeRam = maxRam - ns.getServerUsedRam(currentHost);
    let requiredSolverRam = ns.getScriptRam(solverScript, currentHost);
    const requiredLootRam = ns.getScriptRam(lootScript, currentHost) || 6.5;

    let isSolverRunning = ns.scriptRunning(solverScript, currentHost);
    const isLootRunning = ns.scriptRunning(lootScript, currentHost);
    const isLootDue =
      now - lastLootTime > LOOT_INTERVAL_MS && currentHost !== "home";

    const nearbyServers = ns.dnet.probe();
    let targetToCrack: string | null = null;
    let targetDetails: any = null;

    for (const hostname of nearbyServers) {
      if (hostname === "home") continue;
      if (isServerInCooldown(ns, hostname)) continue;

      let details = ns.dnet.getServerDetails(hostname) as any;
      if (!details.isConnectedToCurrentServer || !details.isOnline) continue;

      if (!details.hasSession) {
        const storedPassword = getPasswordFromRegistry(ns, hostname);
        if (storedPassword !== null) {
          logger.info(
            `🔍 Bekanntes Passwort für ${hostname} in Registry gefunden. Versuche Direkt-Login...`,
          );
          try {
            await ns.dnet.connectToSession(hostname, storedPassword);
            details = ns.dnet.getServerDetails(hostname) as any;

            if (!details.hasSession) {
              logger.warn(
                `⚠️ Direkt-Login für ${hostname} fehlgeschlagen (PW veraltet?). Weiche auf Solver aus.`,
              );
            }
          } catch (e) {
            logger.error(
              `❌ Fehler bei Direkt-Login auf ${hostname}: ${e}`,
              false,
            );
          }
        }
      }

      if (!details.hasSession) {
        if (!targetToCrack) {
          targetToCrack = hostname;
          targetDetails = details;
        }
      } else {
        processedServers.add(hostname);
      }
    }

    if (isLootDue && !isLootRunning && maxRam >= requiredLootRam) {
      if (isSolverRunning) {
        logger.warn(
          `🚨 Loot-Intervall fällig! Erzwinge RAM-Eviction von Solver auf ${currentHost}.`,
        );
        ns.scriptKill(solverScript, currentHost);
        await ns.sleep(200);
        isSolverRunning = false;
        freeRam = maxRam - ns.getServerUsedRam(currentHost);
      }
      targetToCrack = null;
      targetDetails = null;
    }

    let solverStarted = false;

    if (targetToCrack && targetDetails) {
      if (requiredSolverRam === 0) {
        logger.info(
          `📦 Solver-Abhängigkeiten fehlen auf ${currentHost}. Repliziere Krypto-Module von home...`,
        );
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

        if (!ns.scriptRunning(solverScript, currentHost)) {
          logger.info(
            `📡 Target gesichtet: ${targetToCrack} [${targetDetails.modelId}]. Starte Krypto-Solver.`,
          );
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
        }
        solverStarted = true;
      } else {
        logger.debug(
          `ℹ️ RAM knapp auf ${currentHost}. Überlasse ${targetToCrack} dem restlichen Botnetz.`,
        );
      }
    }

    // Fallback Loot-Management
    if (
      currentHost !== "home" &&
      !isSolverRunning &&
      !solverStarted &&
      !isLootRunning &&
      isLootDue
    ) {
      const phishScript = "/tasks/dnet/dnet-phish.js";

      if (
        !ns.fileExists(phishScript, currentHost) ||
        !ns.fileExists(lootScript, currentHost)
      ) {
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

 // Ausbreitung (Wurm-Logik)
    for (const hostname of processedServers) {
      if (!ns.serverExists(hostname)) continue;

      if (!ns.scriptRunning(scriptName, hostname)) {
        const isDarkweb = hostname === "darkweb";
        const minRamRequired = isDarkweb ? 2 : 8; // Darkweb braucht niedrigere Hürde

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
            
            // Vollständiges Paket inklusive des Loggers packen!
            const filesToCopy = [
              scriptName,
              solverScript,
              lootScript,
              "/tasks/dnet/dnet-phish.js",
              "/dnet-master-db.json",
              "/utils/progress.js",
              "/core/logger.js" // Schützt vor dem lautlosen Kompilierungs-Crash
            ];

            // Immer von 'home' oder dem aktuellen Host ziehen, falls vorhanden
            ns.scp(filesToCopy, hostname, currentHost);
            
            // Skript auf dem Remote-Server starten
            ns.exec(scriptName, hostname, 1);
          }
        } else {
          logger.warn(
            `⚠️ ${hostname} hat zu wenig RAM (${ns.getServerMaxRam(hostname)}GB) für den Crawler.`,
          );
        }
      }
    }

    await ns.sleep(5000);
  }
}
