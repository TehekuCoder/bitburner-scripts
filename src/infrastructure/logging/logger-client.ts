import { NS } from "@ns";
import { LogLevel, LoggerContext, LogPayload } from "/shared/types/logger";
import { LOG_PORT } from "../runtime/system";
import { LEVEL_RANK } from "/shared/constants/logger";

// Typ für die erlaubten Context-Werte (passend zu LogPayload in types.ts)
type ContextValue = string | number | boolean | null | undefined;
type ContextRecord = Record<string, ContextValue>;

export class LoggerClient {
  private ns: NS;
  private moduleName: string;
  private portNumber: number;
  private defaultTarget?: string;
  private minLocalLevelRank: number;
  private baseContext: ContextRecord;
  private baseTags: string[];
  private timers: Map<string, number> = new Map();

  constructor(
    ns: NS,
    moduleName: string,
    defaultTarget?: string,
    minLocalLevel: LogLevel = "DEBUG",
    portNumber = LOG_PORT,
    baseContext: ContextRecord = {},
    baseTags: string[] = []
  ) {
    this.ns = ns;
    this.moduleName = moduleName.toUpperCase();
    this.defaultTarget = defaultTarget;
    this.portNumber = portNumber;
    this.minLocalLevelRank = LEVEL_RANK[minLocalLevel] ?? 0;
    
    // PID typkonform als number einbinden
    this.baseContext = { pid: ns.pid, ...baseContext };
    this.baseTags = [...baseTags];
  }

  /**
   * Erstellt einen abgeleiteten Logger für ein spezielles Target (z.B. Host)
   */
  public forTarget(target: string): LoggerClient {
    return new LoggerClient(
      this.ns,
      this.moduleName,
      target,
      "DEBUG",
      this.portNumber,
      this.baseContext,
      this.baseTags
    );
  }

  /**
   * Erstellt einen Child-Logger für Untermodule oder Sub-Funktionen
   */
  public child(
    subModule: string, 
    extraContext?: ContextRecord, 
    extraTags?: string[]
  ): LoggerClient {
    const newModuleName = `${this.moduleName}:${subModule.toUpperCase()}`;
    return new LoggerClient(
      this.ns,
      newModuleName,
      this.defaultTarget,
      "DEBUG",
      this.portNumber,
      { ...this.baseContext, ...(extraContext || {}) },
      [...this.baseTags, ...(extraTags || [])]
    );
  }

  /**
   * Startet eine Zeitmessung
   */
  public time(label: string): void {
    this.timers.set(label, performance.now());
  }

  /**
   * Beendet eine Zeitmessung und sendet die verstrichene Zeit als Log
   */
  public timeEnd(label: string, level: LogLevel = "DEBUG", target?: string): number {
    const start = this.timers.get(label);
    if (!start) {
      this.warn(`Timer '${label}' wurde nicht gestartet.`);
      return 0;
    }
    const duration = Math.round((performance.now() - start) * 100) / 100;
    this.timers.delete(label);
    this.send(level, `⏱️ ${label}: ${duration}ms`, target, {
      context: { durationMs: duration },
    });
    return duration;
  }

  private send(level: LogLevel, msg: string, target?: string, context?: LoggerContext): void {
    const currentTarget = target || this.defaultTarget;
    const levelRank = LEVEL_RANK[level] ?? 0;

    const mergedTags = [...this.baseTags, ...(context?.tags || [])];
    const mergedContext: ContextRecord = { 
      ...this.baseContext, 
      ...(context?.context as ContextRecord || {}) 
    };

    // 1. LOKALES LOGGING
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
      tags: mergedTags.length > 0 ? mergedTags : undefined,
      context: Object.keys(mergedContext).length > 0 ? mergedContext : undefined,
    };

    const success = this.ns.tryWritePort(this.portNumber, payload);
    if (!success) {
      this.ns.print(`⚠️ [LOGGER-CLIENT] Port ${this.portNumber} voll! Log verworfen.`);
    }
  }

  private getLevelIcon(level: LogLevel): string {
    switch (level) {
      case "DEBUG":   return "🔍";
      case "INFO":    return "ℹ️";
      case "SUCCESS": return "✅";
      case "WARN":    return "⚠️";
      case "ERROR":   return "🚨";
      default:        return "📝";
    }
  }

  public debug(msg: string, target?: string, context?: LoggerContext): void { this.send("DEBUG", msg, target, context); }
  public info(msg: string, target?: string, context?: LoggerContext): void { this.send("INFO", msg, target, context); }
  public success(msg: string, target?: string, context?: LoggerContext): void { this.send("SUCCESS", msg, target, context); }
  public warn(msg: string, target?: string, context?: LoggerContext): void { this.send("WARN", msg, target, context); }
  public error(msg: string, target?: string, context?: LoggerContext): void { this.send("ERROR", msg, target, context); }
}