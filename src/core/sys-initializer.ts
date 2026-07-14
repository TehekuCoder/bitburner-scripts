import { NS } from "@ns";
import { DEFAULT_MULTIPLIERS } from "../lib/state.js"; 
import { Logger } from "./logger.js"; // 🆕 Nutze deinen Logger für einheitliche Logs

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Initializer", "INFO");

  // Absolute Pfadangabe stellt sicher, dass die Datei im Hauptverzeichnis landet
  const filePath = "/bn-multipliers.txt";

  try {
    logger.info("Analysiere BitNode-Umgebung via Source-File 5...");

    // Wenn SF5 nicht vorhanden ist, springt der Code sofort in den catch-Block
    const mults = ns.getBitNodeMultipliers();

    ns.write(filePath, JSON.stringify(mults, null, 2), "w");
    logger.success(`${filePath} erfolgreich generiert.`);
  } catch (error) {
    logger.warn("Source-File 5 (Analyse) nicht aktiv. Weiche auf Failsafe-Matrix aus.");

    // Schreibe das importierte statische Objekt ins Root-Verzeichnis
    ns.write(filePath, JSON.stringify(DEFAULT_MULTIPLIERS, null, 2), "w");
    logger.info("Standard-Konfiguration erfolgreich im Root hinterlegt.");
  }
}