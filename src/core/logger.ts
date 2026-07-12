import { NS } from "@ns";

export type LogLevel = "DEBUG" | "INFO" | "SUCCESS" | "WARN" | "ERROR";

export class Logger {
  private ns: NS;
  private moduleName: string;
  private logFile: string;
  private minLevel: LogLevel;
  private writeCount = 0; // Zähler zur Performance-Schonung
  private readonly ROTATE_CHECK_INTERVAL = 50; // Nur alle 50 Writes prüfen
  private readonly MAX_LOG_SIZE = 100_000; // Maximale Zeichenanzahl (~1000 Zeilen)

  private levels: Record<LogLevel, number> = {
    DEBUG: 0, INFO: 1, SUCCESS: 2, WARN: 3, ERROR: 4,
  };

  constructor(ns: NS, moduleName: string, minLevel: LogLevel = "INFO", logFile = "/logs/bitos_system.txt") {
    this.ns = ns;
    this.moduleName = moduleName.toUpperCase();
    this.minLevel = minLevel;
    this.logFile = logFile;
  }

  private formatMessage(level: LogLevel, msg: string): string {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `[${time}.${ms}] [${level.padEnd(7)}] [${this.moduleName}] ${msg}`;
  }

  /**
   * Prüft und rotiert die Logdatei, falls sie zu groß wird
   */
  private handleLogRotation() {
    this.writeCount++;
    if (this.writeCount % this.ROTATE_CHECK_INTERVAL !== 0) return;

    if (this.ns.fileExists(this.logFile, "home")) {
      const currentContent = this.ns.read(this.logFile);
      
      // Wenn das Limit überschritten ist, rotieren wir
      if (currentContent.length > this.MAX_LOG_SIZE) {
        const backupFile = this.logFile.replace(".txt", "_old.txt");
        
        // In Bitburner gibt es kein "rename", also schreiben wir das Backup neu
        this.ns.write(backupFile, currentContent, "w"); 
        // Und überschreiben das aktive Log mit einer leeren Datei
        this.ns.write(this.logFile, "", "w"); 
        
        this.ns.print(`[LOGGER] Log rotation durchgeführt. Altes Log archiviert in ${backupFile}`);
      }
    }
  }

  private log(level: LogLevel, msg: string, forceTerminal = false) {
    if (this.levels[level] < this.levels[this.minLevel]) return;

    const formatted = this.formatMessage(level, msg);

    this.ns.print(formatted);
    this.ns.write(this.logFile, formatted + "\n", "a");

    if (forceTerminal || level === "ERROR") {
      this.ns.tprint(formatted);
    }

    // Rotation nach dem Schreiben prüfen
    this.handleLogRotation();
  }

  public debug(msg: string) { this.log("DEBUG", msg); }
  public info(msg: string) { this.log("INFO", msg); }
  public success(msg: string) { this.log("SUCCESS", msg); }
  public warn(msg: string) { this.log("WARN", msg); }
  public error(msg: string, forceTerminal = true) { this.log("ERROR", msg, forceTerminal); }
}