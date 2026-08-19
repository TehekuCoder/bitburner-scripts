import { NS } from "@ns";
import {
  COOLDOWN_FILE,
  COOLDOWN_MS,
  LOOT_INTERVAL_MS,
  PROCESSED_FILE,
  MASTER_DB_FILE,
} from "../../shared/constants/darknet.js";
import { LoggerClient as Logger } from "/infrastructure/logging/logger-client.js";
import { PATHS } from "../../infrastructure/runtime/paths.js";
import { provisionServer } from "../../lib/utils/provision.js";

let lastLootTime = 0;

/** Sync & Lade verarbeitete Server aus der zentralen JSON-Datei */
function loadProcessedServers(ns: NS, currentHost: string): Set<string> {
  if (currentHost !== "home" && ns.fileExists(PROCESSED_FILE, "home")) {
    ns.scp(PROCESSED_FILE, currentHost, "home");
  }
  if (!ns.fileExists(PROCESSED_FILE)) return new Set<string>();

  try {
    const raw = ns.read(PROCESSED_FILE);
    const data = JSON.parse(raw);
    return new Set(Array.isArray(data) ? data : []);
  } catch {
    return new Set<string>();
  }
}

/** Speichere verarbeitete Server lokal und synchronisiere sie nach 'home' */
function saveProcessedServer(
  ns: NS,
  currentHost: string,
  hostToAdd: string,
  currentSet: Set<string>,
): void {
  currentSet.add(hostToAdd);
  const data = JSON.stringify(Array.from(currentSet));
  ns.write(PROCESSED_FILE, data, "w");
  if (currentHost !== "home") {
    ns.scp(PROCESSED_FILE, "home", currentHost);
  }
}

/** Lade Master-DB einmalig pro Tick */
function loadMasterDb(ns: NS, currentHost: string): Record<string, string> {
  if (currentHost !== "home" && ns.fileExists(MASTER_DB_FILE, "home")) {
    ns.scp(MASTER_DB_FILE, currentHost, "home");
  }
  if (!ns.fileExists(MASTER_DB_FILE)) return {};
  try {
    return JSON.parse(ns.read(MASTER_DB_FILE));
  } catch {
    return {};
  }
}

/** Lade Cooldowns einmalig pro Tick */
function loadCooldowns(ns: NS, currentHost: string): Map<string, number> {
  const cooldownMap = new Map<string, number>();
  if (currentHost !== "home" && ns.fileExists(COOLDOWN_FILE, "home")) {
    ns.scp(COOLDOWN_FILE, currentHost, "home");
  }
  if (!ns.fileExists(COOLDOWN_FILE)) return cooldownMap;

  const lines = ns.read(COOLDOWN_FILE).split("\n");
  for (const line of lines) {
    const parts = line.split(",");
    if (parts.length >= 2) {
      cooldownMap.set(parts[0], Number(parts[1]));
    }
  }
  return cooldownMap;
}

async function ensureSession(
  ns: NS,
  hostname: string,
  details: any,
  masterDb: Record<string, string>,
  logger: Logger,
): Promise<boolean> {
  if (!details || details.isOnline === false) return false;
  if (details.hasSession) return true;

  const passwordCandidates: Array<string | null> = [masterDb[hostname] ?? null];

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
          `✅ Authentifizierung erfolgreich auf ${hostname}.`,
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
      // Ignorieren & nächsten Kandidaten probieren
    }
  }
  return false;
}

async function deployWorm(
  ns: NS,
  hostname: string,
  scriptName: string,
  masterDb: Record<string, string>,
  logger: Logger,
): Promise<boolean> {
  if (hostname === "home" || !ns.serverExists(hostname)) return false;
  if (ns.scriptRunning(scriptName, hostname)) return false;

  // 1. RAM auf dem Zielserver freigeben VOR der Ausführungsprüfung
  try {
    const blockedRam = ns.dnet.getBlockedRam(hostname);
    if (blockedRam > 0) {
      await ns.dnet.memoryReallocation(hostname);
    }
  } catch {
    // Falls API-Methode auf dem Host nicht existiert
  }

  // 2. Dynamischer RAM-Check basierend auf dem tatsächlichen Script-Bedarf
  const requiredRam = ns.getScriptRam(scriptName, ns.getHostname());
  const maxRam = ns.getServerMaxRam(hostname);
  if (maxRam < requiredRam) return false;

  let details: any = null;
  try {
    details = ns.dnet.getServerDetails(hostname);
  } catch {
    return false;
  }

  const sessionReady = await ensureSession(
    ns,
    hostname,
    details,
    masterDb,
    logger,
  );

  if (sessionReady) {
    await provisionServer(ns, hostname, "darknet");

    const freeRam =
      ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname);
    if (freeRam < requiredRam) {
      logger.warn(
        `⚠️ Zu wenig freier RAM auf '${hostname}' (${freeRam.toFixed(2)} GB / ${requiredRam.toFixed(2)} GB benötigt).`,
      );
      return false;
    }

    const pid = ns.exec(scriptName, hostname, 1);
    if (pid > 0) {
      logger.info(
        `🚀 Wurm-Ausbreitung: Infiziere ${hostname} (PID: ${pid}).`,
        undefined,
        {
          tags: ["darknet", "propagation"],
          context: { host: hostname },
        },
      );
      return true;
    } else {
      logger.error(
        `❌ ns.exec für ${scriptName} auf ${hostname} fehlgeschlagen.`,
      );
    }
  }
  return false;
}

export async function main(ns: NS): Promise<void> {
  const scriptName = ns.getScriptName();
  const currentHost = ns.getHostname();
  ns.disableLog("ALL");

  const logger = new Logger(ns, `CRAWLER-${currentHost}`);

  if (currentHost !== "home") {
    try {
      const blockedRam = ns.dnet.getBlockedRam(currentHost);
      if (blockedRam > 0) {
        await ns.dnet.memoryReallocation(currentHost);
      }
    } catch {
      // Ignorieren
    }
  }

  let lastKnownConnections: string[] = [];

  while (true) {
    const now = Date.now();
    const lootScript = PATHS.domain.tasks.loot;
    const phishScript = PATHS.domain.tasks.phish;
    const solverScript = PATHS.domain.tasks.dnetSolver;

    const processedSet = loadProcessedServers(ns, currentHost);
    const masterDb = loadMasterDb(ns, currentHost);
    const cooldowns = loadCooldowns(ns, currentHost);

    const nearbyServers: string[] = ns.dnet.probe();
    const currentTopology = nearbyServers.slice().sort().join(",");
    const lastTopology = lastKnownConnections.slice().sort().join(",");

    if (currentTopology !== lastTopology && lastKnownConnections.length > 0) {
      logger.info(
        `🔄 Topologie-Wechsel: Vorher ${lastKnownConnections.length} | Jetzt ${nearbyServers.length} Nachbarn.`,
      );
    }
    lastKnownConnections = nearbyServers;

    for (const hostname of nearbyServers) {
      if (hostname === "home" || !ns.serverExists(hostname)) continue;

      // 1. Wurm-Ausbreitung
      const deployed = await deployWorm(
        ns,
        hostname,
        scriptName,
        masterDb,
        logger,
      );
      if (deployed) {
        saveProcessedServer(ns, currentHost, hostname, processedSet);
      }

      // 2. Lokales Cracken
      let details: any = null;
      try {
        details = ns.dnet.getServerDetails(hostname);
      } catch {
        continue;
      }

      const cooldownTime = cooldowns.get(hostname) ?? 0;
      const inCooldown = now - cooldownTime < COOLDOWN_MS;

      if (
        details &&
        details.isOnline !== false &&
        !details.hasSession &&
        !inCooldown
      ) {
        const isAnySolverRunning = ns
          .ps(currentHost)
          .some((proc) => proc.filename.includes("dnet-solver"));

        if (isAnySolverRunning) {
          logger.info(`⏳ Solver läuft bereits auf ${currentHost}. Warte...`);
          break;
        }

        const SUB_SOLVER_BUFFER_RAM = 2.6;
        const solverRam = ns.getScriptRam(solverScript, currentHost);
        const totalRequiredRam = solverRam + SUB_SOLVER_BUFFER_RAM;
        const freeRam =
          ns.getServerMaxRam(currentHost) - ns.getServerUsedRam(currentHost);

        if (freeRam >= totalRequiredRam) {
          logger.info(
            `⚡ Starte LOKALEN Solver für '${hostname}' auf ${currentHost}...`,
          );
          if (ns.exec(solverScript, currentHost, 1, hostname) > 0) {
            break;
          }
        } else {
          logger.warn(
            `⚠️ Zu wenig RAM auf '${currentHost}' für '${hostname}'. Benötigt: ${totalRequiredRam.toFixed(2)} GB | Frei: ${freeRam.toFixed(2)} GB`,
          );
        }
      }
    }

    // 3. Phishing / Loot Wartungszyklus
    if (
      currentHost !== "home" &&
      !ns.scriptRunning(lootScript, currentHost) &&
      !ns.scriptRunning(phishScript, currentHost) &&
      now - lastLootTime > LOOT_INTERVAL_MS
    ) {
      if (
        !ns.fileExists(phishScript, currentHost) ||
        !ns.fileExists(lootScript, currentHost)
      ) {
        await provisionServer(ns, currentHost, "darknet");
      }

      const freeRam =
        ns.getServerMaxRam(currentHost) - ns.getServerUsedRam(currentHost);
      const phishRam = ns.getScriptRam(phishScript, currentHost);
      const lootRam = ns.getScriptRam(lootScript, currentHost);
      const requiredRam = Math.max(phishRam, lootRam);

      if (freeRam >= requiredRam) {
        logger.info("🔄 Starte Phishing/Loot-Zyklus...");
        lastLootTime = now;
        ns.exec(phishScript, currentHost, 1);
      }
    }

    await ns.sleep(4000);
  }
}
