import { NS } from "@ns";
import {
  COOLDOWN_FILE,
  COOLDOWN_MS,
  LOOT_INTERVAL_MS,
  PROCESSED_FILE,
  MASTER_DB_FILE,
} from "../../shared/constants/darknet.js";
import { LoggerClient } from "/infrastructure/logging/logger-client.js";
import { PATHS } from "../../infrastructure/runtime/paths.js";

let lastLootTime = 0;

/** Hilfsfunktion zum Prüfen laufender Skripte ohne ns.scriptRunning (spart 1.00 GB) */
function isScriptRunningOnHost(
  ns: NS,
  targetHost: string,
  scriptName: string,
): boolean {
  try {
    return ns.ps(targetHost).some((proc) => proc.filename === scriptName);
  } catch {
    return false;
  }
}

/** Schlanker Dateitransfer ohne schwere Hacking-/Share-Abhängigkeiten */
async function syncRequiredFiles(
  ns: NS,
  targetHost: string,
  files: string[],
  source = "home",
): Promise<void> {
  for (const file of files) {
    if (!ns.fileExists(file, targetHost)) {
      await ns.scp(file, targetHost, source);
    }
  }
}

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
  logger: LoggerClient,
): Promise<boolean> {
  if (!details || details.isOnline === false) return false;
  if (details.hasSession) return true;

  const hostLogger = logger.forTarget(hostname);
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
        hostLogger.success(
          `✅ Authentifizierung erfolgreich auf ${hostname}.`,
          undefined,
          {
            tags: ["darknet", "auth"],
          },
        );
        return true;
      }
    } catch {
      // Ignorieren
    }
  }
  return false;
}

async function deployWorm(
  ns: NS,
  hostname: string,
  scriptName: string,
  masterDb: Record<string, string>,
  logger: LoggerClient,
  requiredFiles: string[],
): Promise<boolean> {
  const currentHost = ns.getHostname();

  if (hostname === "home" || !ns.serverExists(hostname)) return false;

  const hostLogger = logger.forTarget(hostname);
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
  if (!sessionReady) return false;

  if (isScriptRunningOnHost(ns, hostname, scriptName)) {
    return true;
  }

  const requiredRam = ns.getScriptRam(scriptName, currentHost);
  const maxRam = ns.getServerMaxRam(hostname);

  if (maxRam < requiredRam) return false;

  // Kopiert Crawler + alle Imports & Hilfsskripte von 'home' auf das Ziel
  await ns.scp(requiredFiles, hostname, "home");

  const freeRam = ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname);
  if (freeRam < requiredRam) return false;

  const pid = ns.exec(scriptName, hostname, 1);
  if (pid > 0) {
    hostLogger.info(
      `🚀 Wurm-Ausbreitung: Infiziere ${hostname} (PID: ${pid}).`,
      undefined,
      {
        tags: ["darknet", "worm"],
      },
    );
    return true;
  }
  return false;
}

export async function main(ns: NS): Promise<void> {
  const scriptName = ns.getScriptName();
  const currentHost = ns.getHostname();

  ns.disableLog("ALL");

  const logger = new LoggerClient(ns, `CRAWLER-${currentHost}`);
  let lastKnownConnections: string[] = [];
  let lastHeartbeat = 0;
  const HEARTBEAT_INTERVAL_MS = 60_000;

  while (true) {
    try {
      const now = Date.now();

      if (now - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
        logger.info(`💓 Crawler aktiv auf ${currentHost}`, undefined, {
          tags: ["darknet", "heartbeat"],
        });
        lastHeartbeat = now;
      }

      const lootScript = PATHS.domain.tasks.loot;
      const phishScript = PATHS.domain.tasks.phish;
      const solverScript = PATHS.domain.tasks.dnetSolver;

      const processedSet = loadProcessedServers(ns, currentHost);
      const masterDb = loadMasterDb(ns, currentHost);
      const cooldowns = loadCooldowns(ns, currentHost);

      if (!ns.dnet || typeof ns.dnet.probe !== "function") {
        await ns.sleep(10000);
        continue;
      }

      const nearbyServers: string[] = ns.dnet.probe() || [];
      lastKnownConnections = nearbyServers;

      for (const hostname of nearbyServers) {
        if (hostname === "home" || !ns.serverExists(hostname)) continue;

        // Liste aller Abhängigkeiten & Task-Skripte
        const REQUIRED_FILES = [
          scriptName,
          PATHS.services.daemons.crawler,
          PATHS.domain.tasks.dnetSolver,
          PATHS.domain.tasks.loot,
          PATHS.domain.tasks.phish,

          // Utilities & Logging
          PATHS.domain.hacking.provision,
          PATHS.infrastructure.logging.loggerClient,
          PATHS.shared.constants.logger,
          PATHS.shared.types.logger,

          // Runtime & Constants
          PATHS.shared.constants.darknet,
          PATHS.shared.constants.payloads,
          PATHS.shared.constants.colors,
          PATHS.infrastructure.runtime.paths,
          PATHS.infrastructure.runtime.system,

          // Alle Solver-Dateien einzeln entpacken!
          ...Object.values(PATHS.domain.solvers),
        ];

        const deployed = await deployWorm(
          ns,
          hostname,
          scriptName,
          masterDb,
          logger,
          REQUIRED_FILES,
        );
        if (deployed) {
          saveProcessedServer(ns, currentHost, hostname, processedSet);
        }

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
          const isAnySolverRunning = isScriptRunningOnHost(
            ns,
            currentHost,
            "dnet-solver",
          );

          if (isAnySolverRunning) continue;

          const SUB_SOLVER_BUFFER_RAM = 2.6;
          const solverRam = ns.getScriptRam(solverScript, currentHost);
          const totalRequiredRam = solverRam + SUB_SOLVER_BUFFER_RAM;
          const freeRam =
            ns.getServerMaxRam(currentHost) - ns.getServerUsedRam(currentHost);

          if (freeRam >= totalRequiredRam) {
            ns.exec(solverScript, currentHost, 1, hostname);
          }
        }
      }

      // Phishing / Loot Wartungszyklus
      if (
        currentHost !== "home" &&
        !isScriptRunningOnHost(ns, currentHost, lootScript) &&
        !isScriptRunningOnHost(ns, currentHost, phishScript) &&
        now - lastLootTime > LOOT_INTERVAL_MS
      ) {
        await syncRequiredFiles(ns, currentHost, [phishScript, lootScript]);

        const freeRam =
          ns.getServerMaxRam(currentHost) - ns.getServerUsedRam(currentHost);
        const phishRam = ns.getScriptRam(phishScript, currentHost);
        const lootRam = ns.getScriptRam(lootScript, currentHost);
        const requiredRam = Math.max(phishRam, lootRam);

        if (freeRam >= requiredRam) {
          lastLootTime = now;
          ns.exec(phishScript, currentHost, 1);
        }
      }
    } catch (err: any) {
      logger.error(
        `🚨 Fehler im Crawler-Loop auf ${currentHost}: ${err?.message || err}`,
      );
    }

    await ns.sleep(4000);
  }
}
