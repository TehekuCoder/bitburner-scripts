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

function normalizeScriptPath(path: string): string {
  return path.replace(/^\//, "").replace(/\.(ts|js)$/, "");
}

function isServerInCooldown(ns: NS, host: string): boolean {
  const currentHost = ns.getHostname();

  if (currentHost !== "home" && ns.fileExists(COOLDOWN_FILE, "home")) {
    ns.scp(COOLDOWN_FILE, currentHost, "home");
  }

  if (!ns.fileExists(COOLDOWN_FILE)) return false;

  const lines = ns.read(COOLDOWN_FILE).split("\n");
  const now = Date.now();

  for (const line of lines) {
    const parts = line.split(",");
    if (parts.length >= 2) {
      const [cHost, cTime] = parts;
      if (cHost === host && now - Number(cTime) < COOLDOWN_MS) {
        return true;
      }
    }
  }

  return false;
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

  if (
    details.modelId &&
    String(details.modelId).toLowerCase().includes("zerologon")
  ) {
    passwordCandidates.push("");
  }

  passwordCandidates.push("default", "admin", "password", "letmein", "root");

  for (const candidate of passwordCandidates) {
    if (candidate === null) continue;

    try {
      const authResult = await ns.dnet.authenticate(hostname, candidate);
      const authSuccess =
        typeof authResult === "boolean"
          ? authResult
          : Boolean(authResult?.success);

      if (authSuccess) {
        logger.info(
          `✅ Authentifizierung erfolgreich auf ${hostname} mit Bekanntem/Standard-Passwort.`,
          undefined,
          {
            tags: ["darknet", "auth"],
            context: {
              host: hostname,
              model: String(details?.modelId || "unknown"),
            },
          },
        );
        return true;
      }
    } catch {
      // Fallback
    }
  }

  return false;
}

function getPasswordFromRegistry(ns: NS, host: string): string | null {
  const jsonDbFile = "/dnet-master-db.json";
  const currentHost = ns.getHostname();

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
  logger: Logger,
): Promise<boolean> {
  if (hostname === "home" || !ns.serverExists(hostname)) return false;
  if (ns.scriptRunning(scriptName, hostname)) return false;

  const isDarkweb = hostname === "darkweb";
  const minRamRequired = isDarkweb ? 2 : 6;

  if (ns.getServerMaxRam(hostname) < minRamRequired) {
    return false;
  }

  const details = ns.dnet.getServerDetails(hostname) as any;
  const sessionReady = await ensureSession(ns, hostname, details, logger);

  if (sessionReady) {
    logger.info(
      `🚀 Wurm-Ausbreitung: Infiziere ${hostname} und starte Crawler.`,
      undefined,
      { tags: ["darknet", "propagation"], context: { host: hostname } },
    );

    await provisionServer(ns, hostname);
    ns.scp(scriptName, hostname, "home");

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
    const lootScript = PATHS.tasks.loot;
    const phishScript = PATHS.tasks.phish;
    const solverScript = PATHS.tasks.solver;

    const nearbyServers: string[] = ns.dnet.probe();
    const currentTopology = nearbyServers.slice().sort().join(",");
    const lastTopology = lastKnownConnections.slice().sort().join(",");

    if (currentTopology !== lastTopology && lastKnownConnections.length > 0) {
      logger.info(
        `🔄 Topologie-Wechsel erkannt! Vorher: ${lastKnownConnections.length} Nachbarn | Jetzt: ${nearbyServers.length} Nachbarn.`,
      );
    }
    lastKnownConnections = nearbyServers;

    const allTargets = [...new Set([...nearbyServers, ...processedServers])];

    for (const hostname of allTargets) {
      if (hostname === "home" || !ns.serverExists(hostname)) continue;

      // 1. Wurm auf bereits zugängliche Server ausbreiten
      await deployWorm(ns, hostname, scriptName, logger);

      // 2. Ungeknackte DIREKTE Nachbarn LOKAL cracken
      const details = ns.dnet.getServerDetails(hostname) as any;
      const inCooldown = isServerInCooldown(ns, hostname);

      if (details && !details.hasSession && !inCooldown) {
        // Prüfen, ob für dieses Ziel lokal bereits ein Solver läuft
        const targetSolverNormalized = normalizeScriptPath(solverScript);
        const isSolverRunning = ns.ps(currentHost).some(
          (proc) =>
            normalizeScriptPath(proc.filename) === targetSolverNormalized &&
            proc.args[0] === hostname,
        );

        if (!isSolverRunning) {
          const solverRam = ns.getScriptRam(solverScript, currentHost);
          const freeRam = ns.getServerMaxRam(currentHost) - ns.getServerUsedRam(currentHost);

          if (freeRam >= solverRam) {
            logger.info(`⚡ Starte LOKALEN Solver für '${hostname}' auf ${currentHost}...`);
            ns.exec(solverScript, currentHost, 1, hostname);
          } else {
            logger.warn(
              `⚠️ Zu wenig RAM auf '${currentHost}' um Solver für '${hostname}' auszuführen.`,
            );
          }
        }
      }
    }

    // Periodischer Loot / Phishing Zyklus
    if (currentHost !== "home" && !ns.scriptRunning(lootScript, currentHost) && (now - lastLootTime > LOOT_INTERVAL_MS)) {
      if (
        !ns.fileExists(phishScript, currentHost) ||
        !ns.fileExists(lootScript, currentHost)
      ) {
        await provisionServer(ns, currentHost);
      }

      const freeRam = ns.getServerMaxRam(currentHost) - ns.getServerUsedRam(currentHost);
      const phishRam = ns.getScriptRam(phishScript, currentHost);
      const lootRam = ns.getScriptRam(lootScript, currentHost);
      const requiredMaxWorkerRam = Math.max(phishRam, lootRam);

      if (freeRam >= requiredMaxWorkerRam) {
        logger.info("🔄 Starte periodischen Phishing- und Beutezyklus...");
        const phishPid = ns.exec(phishScript, currentHost, 1);
        if (phishPid > 0) {
          while (ns.isRunning(phishPid)) {
            await ns.sleep(300);
          }
        }

        const lootPid = ns.exec(lootScript, currentHost, 1);
        if (lootPid > 0) {
          while (ns.isRunning(lootPid)) {
            await ns.sleep(300);
          }
        }

        lastLootTime = now;
        logger.success("✅ Phishing-Wartungszyklus abgeschlossen.");
      }
    }

    await ns.sleep(4000);
  }
}