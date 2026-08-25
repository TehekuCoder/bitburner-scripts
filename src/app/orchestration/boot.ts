import { NS, BitNodeMultipliers } from "@ns";
import { LoggerClient } from "/infrastructure/logging/logger-client";
import { PATHS } from "/infrastructure/runtime/paths";
import { loadState, patchState } from "/infrastructure/state/state";
import { DEFAULT_MULTIPLIERS } from "/shared/constants/game-defaults";

export async function main(ns: NS): Promise<void> {
  // AST-Parser Referenz für RAM-Kalkulation
  void ns.getHackingLevel;

  ns.disableLog("ALL");
  const logger = new LoggerClient(ns, "Initializer");

  await ensureBitNodeMultipliers(ns, logger);
  ensureInitialState(ns, logger);
  await ensureFactionRoadmap(ns, logger);
}

/**
 * Lädt BitNode-Multiplikatoren via SF5 oder nutzt Failsafe-Defaults.
 */
async function ensureBitNodeMultipliers(ns: NS, logger: LoggerClient): Promise<void> {
  const filePath = PATHS.shared?.settings.bnMultipliers;

  try {
    // Falls SF5 vorhanden ist, erzwingen wir ein Update für den aktuellen BitNode
    const liveMults = ns.getBitNodeMultipliers();
    const mergedMults: BitNodeMultipliers = { ...DEFAULT_MULTIPLIERS, ...liveMults };
    
    ns.write(filePath, JSON.stringify(mergedMults, null, 2), "w");
    logger.success("BitNode-Multiplikatoren via SF5 aktualisiert.");
  } catch {
    if (!ns.fileExists(filePath, "home")) {
      logger.warn("Source-File 5 nicht aktiv. Erstelle Failsafe-Matrix.");
      ns.write(filePath, JSON.stringify(DEFAULT_MULTIPLIERS, null, 2), "w");
    } else {
      logger.info("Verwende gecachte BitNode-Multiplikatoren (Failsafe).");
    }
  }
}

/**
 * Stellt sicher, dass ein Grund-State im Speicher existiert.
 */
function ensureInitialState(ns: NS, logger: LoggerClient): void {
  const currentState = loadState(ns);
  if (!currentState) {
    logger.info("Kein State gefunden. Initialisiere Basis-State...");
    patchState(ns, { strategy: "MONEY", augRoadMap: [] });
  }
}

/**
 * Führt die Faction-Analyse aus, falls noch keine Roadmap vorliegt.
 */
async function ensureFactionRoadmap(ns: NS, logger: LoggerClient): Promise<void> {
  const currentState = loadState(ns);
  if (currentState?.augRoadMap && currentState.augRoadMap.length > 0) {
    logger.info("Gültige Faction-Roadmap erkannt. Überspringe Analyse.");
    return;
  }

  const scriptPath = PATHS.domain.tasks.analyzeAug;
  if (!ns.fileExists(scriptPath, "home")) {
    logger.error(`Kritischer Fehler: '${scriptPath}' nicht gefunden!`);
    return;
  }

  const analyzeRam = ns.getScriptRam(scriptPath, "home");
  const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");

  if (freeRam < analyzeRam) {
    logger.warn(`Zu wenig RAM auf 'home' (${freeRam.toFixed(1)} GB frei, ${analyzeRam} GB benötigt).`);
    return;
  }

  logger.info("Starte Faction-Roadmap Analyse...");
  const pid = ns.run(scriptPath, 1);

  if (pid === 0) {
    logger.error("Kritischer Fehler: Skript konnte nicht gestartet werden.");
    return;
  }

  // Synchrones Warten mit Timeout (max. 10 Sekunden / 200 Ticks)
  let maxTicks = 200;
  while (ns.isRunning(pid) && maxTicks > 0) {
    await ns.sleep(50);
    maxTicks--;
  }

  if (maxTicks === 0) {
    logger.error("Timeout bei der Faction-Roadmap Analyse!");
  } else {
    logger.success("Faction-Roadmap erfolgreich generiert.");
  }
}