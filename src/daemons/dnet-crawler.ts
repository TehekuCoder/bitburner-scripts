import { NS } from "@ns";
import {
  COOLDOWN_FILE,
  COOLDOWN_MS,
  LOOT_INTERVAL_MS,
  processedServers,
} from "/lib/constants";
import { Logger } from "/lib/logger";

let lastLootTime = 0;
let dbCache: Record<string, string> | null = null;
let lastDbRead = 0;

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
 * Holt zuverlässig alle Dateien aus dem /solvers/ Ordner auf home.
 */
function getSolverFiles(ns: NS): string[] {
  return ns.ls("home").filter((file) => file.includes("solvers/"));
}

/**
 * Liest das Passwort aus der Master-DB mit In-Memory Caching (Refresh alle 10 Sek.).
 */
function getPasswordFromRegistry(ns: NS, host: string): string | null {
  const jsonDbFile = "/dnet-master-db.json";
  const now = Date.now();

  if (!dbCache || now - lastDbRead > 10000) {
    if (!ns.fileExists(jsonDbFile)) return null;
    try {
      const dbContent = ns.read(jsonDbFile);
      if (!dbContent) return null;
      dbCache = JSON.parse(dbContent);
      lastDbRead = now;
    } catch {
      return null;
    }
  }

  return dbCache ? (dbCache[host] ?? null) : null;
}

/**
 * Einheitliche Wurm-Ausbreitung auf einen Ziel-Knoten.
 */
async function deployWorm(
  ns: NS,
  hostname: string,
  scriptName: string,
  solverScript: string,
  lootScript: string,
  phishScript: string,
  logger: Logger,
): Promise<boolean> {
  if (hostname === "home" || !ns.serverExists(hostname)) return false;
  if (ns.scriptRunning(scriptName, hostname)) return false;

  const isDarkweb = hostname === "darkweb";
  const minRamRequired = isDarkweb ? 2 : 8;

  if (ns.getServerMaxRam(hostname) < minRamRequired) {
    logger.warn(
      `⚠️ ${hostname} hat zu wenig RAM (${ns.getServerMaxRam(hostname)}GB) für den Crawler.`,
    );
    return false;
  }

  let details = ns.dnet.getServerDetails(hostname) as any;
  let sessionReady = details.hasSession;

  if (!sessionReady) {
    const password = getPasswordFromRegistry(ns, hostname);
    if (password !== null) {
      await ns.dnet.connectToSession(hostname, password);
      details = ns.dnet.getServerDetails(hostname) as any;
      sessionReady = details.hasSession;
    }
  }

  if (sessionReady) {
    logger.info(
      `🚀 Wurm-Ausbreitung: Infiziere ${hostname} und starte Crawler.`,
    );

    const solverModules = getSolverFiles(ns);
    const filesToCopy = [
      scriptName,
      solverScript,
      lootScript,
      phishScript,
      "/dnet-master-db.json",
      "/lib/constants.js",
      "/lib/logger.js",
      "/lib/types.js",
      ...solverModules,
    ];

    ns.scp(filesToCopy, hostname, "home");

    ns.scp(filesToCopy, hostname, "home");

    // exec funktioniert bei Darknet nur auf DIREKT verbundenen Nodes
    if (details.isConnectedToCurrentServer || isDarkweb) {
      ns.exec(scriptName, hostname, 1);
      return true;
    }
  }

  return false;
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
    const blockedRam = ns.dnet.getBlockedRam(currentHost);
    if (blockedRam > 0) {
      await ns.dnet.memoryReallocation(currentHost);
    }
  }

  let lastKnownConnections: string[] = [];

  while (true) {
    const now = Date.now();
    const solverScript = "tasks/dnet-solver.js";
    const lootScript = "tasks/dnet-loot.js";
    const phishScript = "tasks/dnet-phish.js";

    const maxRam = ns.getServerMaxRam(currentHost);
    let freeRam = maxRam - ns.getServerUsedRam(currentHost);
    let requiredSolverRam = ns.getScriptRam(solverScript, currentHost);
    const requiredLootRam = ns.getScriptRam(lootScript, currentHost) || 6.5;

    let isSolverRunning = ns.scriptRunning(solverScript, currentHost);
    const isLootRunning = ns.scriptRunning(lootScript, currentHost);
    const isLootDue =
      now - lastLootTime > LOOT_INTERVAL_MS && currentHost !== "home";

    const nearbyServers: string[] = ns.dnet.probe();

    // Topologie-Überwachung
    const currentTopology = nearbyServers.slice().sort().join(",");
    const lastTopology = lastKnownConnections.slice().sort().join(",");

    if (currentTopology !== lastTopology && lastKnownConnections.length > 0) {
      logger.info(
        `🔄 Topologie-Wechsel erkannt! Vorher: ${lastKnownConnections.length} Nachbarn | Jetzt: ${nearbyServers.length} Nachbarn.`,
      );
    }
    lastKnownConnections = nearbyServers;

    let targetToCrack: string | null = null;
    let targetDetails: any = null;

    // 1. SCAN & TARGET EVALUATION: Nahegelegene Server prüfen + Wurm ausbreiten
    for (const hostname of nearbyServers) {
      if (hostname === "home" || !ns.serverExists(hostname)) continue;

      // Ausbreitung auf Nachbarn
      await deployWorm(
        ns,
        hostname,
        scriptName,
        solverScript,
        lootScript,
        phishScript,
        logger,
      );

      // Ziel-Erkennung für den Krypto-Solver
      if (!targetToCrack) {
        const details = ns.dnet.getServerDetails(hostname) as any;
        if (
          details &&
          !details.hasSession &&
          !isServerInCooldown(ns, hostname)
        ) {
          targetToCrack = hostname;
          targetDetails = details;
        }
      }
    }

    // 2. WURM-AUSBREITUNG AUF BEKANNTE PROCESSED SERVERS
    for (const hostname of processedServers) {
      await deployWorm(
        ns,
        hostname,
        scriptName,
        solverScript,
        lootScript,
        phishScript,
        logger,
      );
    }

    // 3. LOOT EVICTION
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

    // 4. SOLVER EXECUTION
    if (targetToCrack && targetDetails && !isSolverRunning) {
      const hasSolverModules =
        ns.fileExists("solvers/solveManager.js", currentHost) ||
        ns.fileExists("solvers/solveManager.ts", currentHost);

      if (requiredSolverRam === 0 || !hasSolverModules) {
        const solverModules = getSolverFiles(ns);
        if (solverModules.length > 0) {
          logger.info(
            `📦 Solver-Abhängigkeiten fehlen auf ${currentHost}. Repliziere ${solverModules.length} Krypto-Module von home...`,
          );
          ns.scp([solverScript, ...solverModules], currentHost, "home");
        }
        requiredSolverRam = ns.getScriptRam(solverScript, currentHost);
      }

      if (requiredSolverRam > 0 && freeRam >= requiredSolverRam) {
        if (isLootRunning) {
          ns.scriptKill(lootScript, currentHost);
          await ns.sleep(200);
        }

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
        solverStarted = true;
      } else {
        logger.debug(
          `ℹ️ RAM knapp auf ${currentHost}. Überlasse ${targetToCrack} dem restlichen Botnetz.`,
        );
      }
    }

    // 5. PERIODISCHER PHISHING- & LOOT-ZYKLUS
    if (
      currentHost !== "home" &&
      !isSolverRunning &&
      !solverStarted &&
      !isLootRunning &&
      isLootDue
    ) {
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
          while (ns.isRunning(phishPid)) {
            await ns.sleep(500);
          }
        }

        const lootPid = ns.exec(lootScript, currentHost, 1);
        if (lootPid > 0) {
          while (ns.isRunning(lootPid)) {
            await ns.sleep(500);
          }
        }

        lastLootTime = now;
        logger.success("✅ Phishing-Wartungszyklus abgeschlossen.");
      }
    }

    await ns.sleep(5000);
  }
}
