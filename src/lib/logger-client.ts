import { NS } from "@ns";
import { LogLevel, LogPayload, LoggerContext } from "lib/types.js";
import { LOG_PORT, LEVEL_RANK } from "lib/constants.js";

export class LoggerClient {
  private ns: NS;
  private moduleName: string;
  private portNumber: number;
  private defaultTarget?: string;
  private minLocalLevelRank: number;

  constructor(
    ns: NS,
    moduleName: string,
    defaultTarget?: string,
    minLocalLevel: LogLevel = "DEBUG", // Standard: Zeige lokal ALLE Details
    portNumber = LOG_PORT
  ) {
    this.ns = ns;
    this.moduleName = moduleName.toUpperCase();
    this.defaultTarget = defaultTarget;
    this.portNumber = portNumber;
    this.minLocalLevelRank = LEVEL_RANK[minLocalLevel] ?? 0;
  }

  /**
   * Erstellt einen abgeleiteten Logger mit festem Ziel-Fokus (z.B. für einen Batcher-Loop)
   */
  public forTarget(target: string): LoggerClient {
    return new LoggerClient(this.ns, this.moduleName, target, "DEBUG", this.portNumber);
  }

  private send(level: LogLevel, msg: string, target?: string, context?: LoggerContext): void {
    const currentTarget = target || this.defaultTarget;
    const levelRank = LEVEL_RANK[level] ?? 0;

    // 1. LOKALES LOGGING (Einfluss auf das eigene ns.print / Tail-Fenster)
    if (levelRank >= this.minLocalLevelRank) {
      const targetStr = currentTarget ? ` [${currentTarget.toLowerCase()}]` : "";
      const icon = this.getLevelIcon(level);
      this.ns.print(`${icon} [${level.padEnd(5)}]${targetStr} ${msg}`);
    }

    // 2. ZENTRALES LOGGING (An Port senden)
    const payload: LogPayload = {
      module: this.moduleName,
      level,
      msg,
      timestamp: Date.now(),
      target: currentTarget,
      tags: context?.tags,
      context: context?.context,
    };

    const success = this.ns.tryWritePort(this.portNumber, payload);
    if (!success) {
      this.ns.print(`⚠️ [LOGGER-CLIENT] Port ${this.portNumber} voll! Log verworfen.`);
    }
  }

  private getLevelIcon(level: LogLevel): string {
    switch (level) {
      case "DEBUG": return "🔍";
      case "INFO":  return "ℹ️";
      case "SUCCESS": return "✅";
      case "WARN":  return "⚠️";
      case "ERROR": return "🚨";
      default:      return "📝";
    }
  }

  public debug(msg: string, target?: string, context?: LoggerContext): void { this.send("DEBUG", msg, target, context); }
  public info(msg: string, target?: string, context?: LoggerContext): void { this.send("INFO", msg, target, context); }
  public success(msg: string, target?: string, context?: LoggerContext): void { this.send("SUCCESS", msg, target, context); }
  public warn(msg: string, target?: string, context?: LoggerContext): void { this.send("WARN", msg, target, context); }
  public error(msg: string, target?: string, context?: LoggerContext): void { this.send("ERROR", msg, target, context); }
}