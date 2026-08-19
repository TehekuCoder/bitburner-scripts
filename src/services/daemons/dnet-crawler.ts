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
  logger: LoggerClient,
): Promise<boolean> {
  if (!details || details.isOnline === false) return false;
  if (details.hasSession) return true;

  const hostLogger = logger.forTarget(hostname);
  hostLogger.debug(`Starte Session-Herstellung für ${hostname}...`, undefined, {
    tags: ["darknet", "auth"],
  });

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
          `✅ Authentifizierung erfolgreich auf ${hostname} (Passwort: '${candidate || "<empty>"}').`,
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
      } else {
        hostLogger.debug(
          `Fehlgeschlagener Auth-Versuch auf ${hostname} mit PW: '${candidate}'`,
          undefined,
          { tags: ["darknet", "auth"] },
        );
      }
    } catch (err: any) {
      hostLogger.debug(
        `Ausnahme bei Auth-Versuch auf ${hostname}: ${err?.message || err}`,
        undefined,
        { tags: ["darknet", "auth"] },
      );
    }
  }

  hostLogger.warn(
    `⚠️ Alle Authentifizierungsversuche für ${hostname} fehlgeschlagen.`,
    undefined,
    {
      tags: ["darknet", "auth"],
      context: { host: hostname, model: String(details?.modelId || "unknown") },
    },
  );
  return false;
}

async function deployWorm(
  ns: NS,
  hostname: string,
  scriptName: string,
  masterDb: Record<string, string>,
  logger: LoggerClient,
): Promise<boolean> {
  const currentHost = ns.getHostname();

  if (
    hostname === "home" ||
    !ns.serverExists(hostname)
  ) {
    return false;
  }

  const hostLogger = logger.forTarget(hostname);

  let details: any = null;
  try {
    details = ns.dnet.getServerDetails(hostname);
  } catch (err: any) {
    hostLogger.debug(
      `Konnte Server-Details für ${hostname} nicht abrufen: ${err?.message || err}`,
      undefined,
      { tags: ["darknet", "worm"] },
    );
    return false;
  }

  // 1. Authentifizierung IMMER zuerst sicherstellen
  const sessionReady = await ensureSession(
    ns,
    hostname,
    details,
    masterDb,
    logger,
  );
  if (!sessionReady) return false;

  // 2. Prüfen, ob das Skript bereits läuft
  if (ns.scriptRunning(scriptName, hostname)) {
    hostLogger.debug(`Wurm läuft bereits auf ${hostname}.`, undefined, {
      tags: ["darknet", "worm"],
    });
    return true;
  }

  // 3. RAM-Check für Ausführung auf dem Zielhost
  const requiredRam = ns.getScriptRam(scriptName, currentHost);
  const maxRam = ns.getServerMaxRam(hostname);

  if (maxRam < requiredRam) {
    hostLogger.debug(
      `Max-RAM zu gering für Wurm auf ${hostname}: ${maxRam} GB < ${requiredRam} GB`,
      undefined,
      {
        tags: ["darknet", "worm"],
        context: { host: hostname, maxRam, requiredRam },
      },
    );
    return false;
  }

  try {
    const blockedRam = ns.dnet.getBlockedRam(hostname);
    if (blockedRam > 0) {
      hostLogger.debug(
        `Führe RAM-Reallocation für ${hostname} durch (Blocked: ${blockedRam} GB)...`,
        undefined,
        { tags: ["darknet", "worm"] },
      );
      await ns.dnet.memoryReallocation(hostname);
    }
  } catch {
    // Ignorieren falls API nicht vorhanden
  }

  // 4. Provisionieren & Skript starten
  await provisionServer(ns, hostname, "darknet");
  await ns.scp(scriptName, hostname, currentHost);

  const freeRam = ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname);
  if (freeRam < requiredRam) {
    hostLogger.debug(
      `Freier RAM zu gering für Wurm-Start auf ${hostname}: ${freeRam.toFixed(2)} GB < ${requiredRam} GB`,
      undefined,
      {
        tags: ["darknet", "worm"],
        context: { host: hostname, freeRam, requiredRam },
      },
    );
    return false;
  }

  const pid = ns.exec(scriptName, hostname, 1);
  if (pid > 0) {
    hostLogger.info(
      `🚀 Wurm-Ausbreitung: Infiziere ${hostname} (PID: ${pid}).`,
      undefined,
      {
        tags: ["darknet", "worm"],
        context: { host: hostname, pid },
      },
    );
    return true;
  } else {
    hostLogger.error(
      `🚨 Wurm konnte auf ${hostname} trotz ausreichend RAM nicht gestartet werden (PID: 0).`,
      undefined,
      { tags: ["darknet", "worm"], context: { host: hostname } },
    );
  }
  return false;
}

export async function main(ns: NS): Promise<void> {
  const scriptName = ns.getScriptName();
  const currentHost = ns.getHostname();
  ns.disableLog("ALL");

  const logger = new LoggerClient(ns, `CRAWLER-${currentHost}`);

  if (currentHost !== "home") {
    try {
      const blockedRam = ns.dnet.getBlockedRam(currentHost);
      if (blockedRam > 0) {
        logger.debug(
          `Realloziere blockierten RAM auf ${currentHost} (${blockedRam} GB)...`,
          undefined,
          { tags: ["darknet", "ram"] },
        );
        await ns.dnet.memoryReallocation(currentHost);
      }
    } catch {
      logger.error(
        `Realloziere blockierten RAM auf ${currentHost} nicht möglich...`,
      );
    }
  }

  let lastKnownConnections: string[] = [];
  let lastHeartbeat = 0;
  const HEARTBEAT_INTERVAL_MS = 60_000;

  while (true) {
    try {
      const now = Date.now();

      // 0. Heartbeat-Log für Lebenszeichen im Steady-State
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

      // Sichere Abfrage der Nachbarn
      if (!ns.dnet || typeof ns.dnet.probe !== "function") {
        logger.error(`🚨 ns.dnet API auf ${currentHost} nicht verfügbar!`);
        await ns.sleep(10000);
        continue;
      }

      const nearbyServers: string[] = ns.dnet.probe() || [];

      const currentTopology = nearbyServers.slice().sort().join(",");
      const lastTopology = lastKnownConnections.slice().sort().join(",");

      if (currentTopology !== lastTopology && lastKnownConnections.length > 0) {
        logger.info(
          `🔄 Topologie-Wechsel auf ${currentHost}: Vorher ${lastKnownConnections.length} | Jetzt ${nearbyServers.length} Nachbarn.`,
          undefined,
          { tags: ["darknet", "topology"] },
        );
      }
      lastKnownConnections = nearbyServers;

      for (const hostname of nearbyServers) {
        if (hostname === "home" || !ns.serverExists(hostname)) continue;

        const hostLogger = logger.forTarget(hostname);

        // 1. Wurm-Ausbreitung versuchen
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

        if (inCooldown && !details.hasSession) {
          hostLogger.debug(
            `Überspringe Crack-Versuch für ${hostname}: Noch im Cooldown (${Math.ceil((COOLDOWN_MS - (now - cooldownTime)) / 1000)}s verbleibend).`,
            undefined,
            { tags: ["darknet", "solver", "cooldown"] },
          );
        }

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
            hostLogger.debug(
              `Solver-Start für '${hostname}' übersprungen: Ein anderer Solver läuft bereits auf ${currentHost}.`,
              undefined,
              { tags: ["darknet", "solver"] },
            );
            continue;
          }

          const SUB_SOLVER_BUFFER_RAM = 2.6;
          const solverRam = ns.getScriptRam(solverScript, currentHost);
          const totalRequiredRam = solverRam + SUB_SOLVER_BUFFER_RAM;
          const freeRam =
            ns.getServerMaxRam(currentHost) - ns.getServerUsedRam(currentHost);

          if (freeRam >= totalRequiredRam) {
            hostLogger.info(
              `⚡ Starte LOKALEN Solver für '${hostname}' auf ${currentHost}...`,
              undefined,
              {
                tags: ["darknet", "solver"],
                context: {
                  targetHost: hostname,
                  requiredRam: totalRequiredRam,
                  freeRam,
                },
              },
            );
            ns.exec(solverScript, currentHost, 1, hostname);
          } else {
            hostLogger.warn(
              `⚠️ Zu wenig RAM auf '${currentHost}' für Solver an '${hostname}'. Benötigt: ${totalRequiredRam.toFixed(2)} GB | Frei: ${freeRam.toFixed(2)} GB`,
              undefined,
              {
                tags: ["darknet", "solver", "ram"],
                context: {
                  targetHost: hostname,
                  requiredRam: totalRequiredRam,
                  freeRam,
                },
              },
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
          logger.debug(
            `Provisioniere ${currentHost} für Phish/Loot-Zyklus...`,
            undefined,
            { tags: ["darknet", "loot"] },
          );
          await provisionServer(ns, currentHost, "darknet");
        }

        const freeRam =
          ns.getServerMaxRam(currentHost) - ns.getServerUsedRam(currentHost);
        const phishRam = ns.getScriptRam(phishScript, currentHost);
        const lootRam = ns.getScriptRam(lootScript, currentHost);
        const requiredRam = Math.max(phishRam, lootRam);

        if (freeRam >= requiredRam) {
          logger.info("🔄 Starte Phishing/Loot-Zyklus...", undefined, {
            tags: ["darknet", "loot"],
          });
          lastLootTime = now;
          ns.exec(phishScript, currentHost, 1);
        } else {
          logger.debug(
            `Phish/Loot-Zyklus übersprungen auf ${currentHost}: Nicht genug RAM (${freeRam.toFixed(2)} GB < ${requiredRam.toFixed(2)} GB)`,
            undefined,
            { tags: ["darknet", "loot", "ram"] },
          );
        }
      }
    } catch (err: any) {
      logger.error(
        `🚨 Unerwarteter Fehler im Crawler-Loop auf ${currentHost}: ${err?.message || err}`,
        undefined,
        { tags: ["darknet", "crash"] },
      );
    }

    await ns.sleep(4000);
  }
}
