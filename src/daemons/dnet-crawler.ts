import { NS } from "@ns";
import {
  COOLDOWN_FILE,
  COOLDOWN_MS,
  LOOT_INTERVAL_MS,
  processedServers,
} from "/lib/constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { PATHS } from "/lib/paths";
import { provisionServer } from "/utils/provision";

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

function getSolverFiles(ns: NS): string[] {
  return ns.ls("home").filter((file) => file.includes("solvers/"));
}

async function ensureSession(
  ns: NS,
  hostname: string,
  details: any,
  logger: Logger,
): Promise<boolean> {
  if (!details) return false;

  const isConnected = details.isConnectedToCurrentServer !== false;
  const isOnline = details.isOnline !== false;
  if (!isConnected || !isOnline) return false;

  if (details.hasSession) return true;

  const passwordCandidates: Array<string | null> = [
    getPasswordFromRegistry(ns, hostname),
  ];

  if (details.modelId && String(details.modelId).toLowerCase().includes("zerologon")) {
    passwordCandidates.push("");
  }

  passwordCandidates.push("admin");
  passwordCandidates.push("password");
  passwordCandidates.push("letmein");
  passwordCandidates.push("root");

  for (const candidate of passwordCandidates) {
    if (!candidate) continue;

    try {
      const authResult = await ns.dnet.authenticate(hostname, candidate);
      const authSuccess =
        typeof authResult === "boolean"
          ? authResult
          : Boolean(authResult?.success);

      if (authSuccess) {
        logger.info(`✅ Authentifizierung erfolgreich auf ${hostname} mit Passwort-Variante.`, undefined, {
          tags: ["darknet", "auth"],
          context: { host: hostname, model: String(details?.modelId || "unknown") },
        });
        return true;
      }
    } catch {
      // Fallback auf die nächste Variante
    }
  }

  return false;
}

function getPasswordFromRegistry(ns: NS, host: string): string | null {
  const jsonDbFile = "/dnet-master-db.json";
  const currentHost = ns.getHostname();

  // 🔄 Falls wir nicht auf home sind: Neueste DB von 'home' ziehen
  if (currentHost !== "home" && ns.fileExists(jsonDbFile, "home")) {
    ns.scp(jsonDbFile, currentHost, "home");
  }

  if (!ns.fileExists(jsonDbFile)) return null;
  try {
    const dbContent = ns.read(jsonDbFile);
    if (!dbContent) return null;
    const db = JSON.parse(dbContent);
    return db[host] ?? null;
  } catch {
    return null;
  }
}

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

  const details = ns.dnet.getServerDetails(hostname) as any;
  const sessionReady = await ensureSession(ns, hostname, details, logger);

  // ✅ Wenn Session steht: Wurm kopieren & starten!
  if (sessionReady) {
    logger.info(
      `🚀 Wurm-Ausbreitung: Infiziere ${hostname} und starte Crawler.`,
      undefined,
      { tags: ["darknet", "propagation"], context: { host: hostname } },
    );

    await provisionServer(ns, hostname);
    await provisionServer(ns, ns.getHostname());
    ns.scp(scriptName, hostname, ns.getHostname());

    const pid = ns.exec(scriptName, hostname, 1);
    return pid > 0;
  }

  return false;
}
export async function main(ns: NS): Promise<void> {
  const scriptName = ns.getScriptName();
  const currentHost = ns.getHostname();
  ns.disableLog("ALL");

  const logger = new Logger(ns, `CRAWLER-${currentHost}`);

  if (currentHost !== "home") {
    const blockedRam = ns.dnet.getBlockedRam(currentHost);
    if (blockedRam > 0) {
      await ns.dnet.memoryReallocation(currentHost);
    }
  }

  let lastKnownConnections: string[] = [];

  while (true) {
    const now = Date.now();
    const solverScript = PATHS.tasks.solver;
    const lootScript = PATHS.tasks.loot;
    const phishScript = PATHS.tasks.phish;

    const maxRam = ns.getServerMaxRam(currentHost);
    let freeRam = maxRam - ns.getServerUsedRam(currentHost);
    let requiredSolverRam = ns.getScriptRam(solverScript, currentHost);
    const requiredLootRam = ns.getScriptRam(lootScript, currentHost) || 6.5;

    let isSolverRunning = ns.scriptRunning(solverScript, currentHost);
    const isLootRunning = ns.scriptRunning(lootScript, currentHost);
    const isLootDue =
      now - lastLootTime > LOOT_INTERVAL_MS && currentHost !== "home";

    const nearbyServers: string[] = ns.dnet.probe();

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

    for (const hostname of nearbyServers) {
      if (hostname === "home" || !ns.serverExists(hostname)) continue;

      await deployWorm(
        ns,
        hostname,
        scriptName,
        solverScript,
        lootScript,
        phishScript,
        logger,
      );

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

    if (targetToCrack && targetDetails && !isSolverRunning) {
      const hasSolverModules =
        ns.fileExists("/solvers/solveManager.js", currentHost) ||
        ns.fileExists("/solvers/solveManager.ts", currentHost);

      if (requiredSolverRam === 0 || !hasSolverModules) {
        // HIER ANGEPASST: Einfach den Server provisionieren lassen
        logger.info(
          `📦 Solver-Abhängigkeiten fehlen auf ${currentHost}. Provisioniere Server von home...`,
        );
        await provisionServer(ns, currentHost);

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

        // HIER AUFGERÄUMT: Die unnötigen Parameter entfernt (wie im letzten Schritt besprochen)
        ns.exec(solverScript, currentHost, 1, targetToCrack);
        solverStarted = true;
      } else {
        logger.debug(
          `ℹ️ RAM knapp auf ${currentHost}. Überlasse ${targetToCrack} dem restlichen Botnetz.`,
        );
      }
    }

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
        // HIER ANGEPASST: provisionServer statt ns.scp
        await provisionServer(ns, currentHost);
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
