import { NS } from "@ns";
import { loadState, patchState } from "./state-manager.js"; 
import { Logger } from "./logger.js";
import { DEFAULT_MULTIPLIERS } from "/lib/constants.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Initializer", "INFO");

  const multsFilePath = "/bn-multipliers.txt";
  const analyzeAugmentationsScript = "/tasks/analyze-augmentations.js";

  // --- SCHRITT 1: BITNODE MULTIPLIKATOREN ERMITTELN ---
  try {
    logger.info("Analysiere BitNode-Umgebung via Source-File 5...");
    const mults = ns.getBitNodeMultipliers();
    ns.write(multsFilePath, JSON.stringify(mults, null, 2), "w");
    logger.success(`${multsFilePath} erfolgreich generiert.`);
  } catch (error) {
    logger.warn("Source-File 5 (Analyse) nicht aktiv. Weiche auf Failsafe-Matrix aus.");
    ns.write(multsFilePath, JSON.stringify(DEFAULT_MULTIPLIERS, null, 2), "w");
    logger.info("Standard-Konfiguration erfolgreich im Root hinterlegt.");
  }

  // --- SCHRITT 2: BASIS-STATE PRÜFEN & INITIALISIEREN ---
  let currentState = loadState(ns);
  if (!currentState) {
    logger.info("Kein globaler State gefunden. Initialisiere leeren Basis-State...");
    patchState(ns, { 
      strategy: "MONEY", 
      factionTargets: {} 
    });
    currentState = loadState(ns);
  }

  // --- SCHRITT 3: FACTION ROADMAP VORBEREITEN (SYNCHRON!) ---
  const factionTargets = currentState?.factionTargets ?? {};
  const hasRoadmap = Object.keys(factionTargets).length > 0;

  if (!hasRoadmap) {
    logger.info("Faction-Roadmap Targets fehlen im State. Starte Analyse...");
    
    if (ns.fileExists(analyzeAugmentationsScript, "home")) {
      const analyzeRam = ns.getScriptRam(analyzeAugmentationsScript, "home");
      const freeRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home");

      if (freeRam >= analyzeRam) {
        const analyzePid = ns.run(analyzeAugmentationsScript, 1);
        
        if (analyzePid > 0) {
          // 🟢 Synchrones Warten: Der Initializer blockiert den Bootloader, 
          // bis die Analyse die Roadmap fertig in den State geschrieben hat.
          while (ns.isRunning(analyzePid)) {
            await ns.sleep(50);
          }
          logger.success("Faction-Roadmap erfolgreich generiert und im State hinterlegt.");
        } else {
          logger.error("Kritischer Fehler: Analyse-Skript konnte nicht gestartet werden.");
        }
      } else {
        logger.warn(`Zu wenig RAM auf 'home' (${freeRam.toFixed(1)} GB frei). Analyse verzögert.`);
      }
    } else {
      logger.error(`Kritischer Fehler: '${analyzeAugmentationsScript}' existiert nicht!`);
    }
  } else {
    logger.info("Gültige Faction-Roadmap im State erkannt. Überspringe Analyse.");
  }
}