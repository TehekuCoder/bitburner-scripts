import { NS } from "@ns";
import { LogLevel, LogPayload, LoggerContext } from "lib/types.js";
import { LOG_PORT } from "lib/constants.js";

export class LoggerClient {
  private ns: NS;
  private moduleName: string;
  private portNumber: number;
  private defaultTarget?: string;

  constructor(ns: NS, moduleName: string, defaultTarget?: string, portNumber = LOG_PORT) {
    this.ns = ns;
    this.moduleName = moduleName.toUpperCase();
    this.defaultTarget = defaultTarget;
    this.portNumber = portNumber;
  }

  /**
   * Erstellt einen abgeleiteten Logger mit festem Ziel-Fokus (z.B. für einen Batcher-Loop)
   */
  public forTarget(target: string): LoggerClient {
    return new LoggerClient(this.ns, this.moduleName, target, this.portNumber);
  }

  private send(level: LogLevel, msg: string, target?: string, context?: LoggerContext): void {
    const payload: LogPayload = {
      module: this.moduleName,
      level,
      msg,
      timestamp: Date.now(),
      target: target || this.defaultTarget,
      tags: context?.tags,
      context: context?.context,
    };

    const success = this.ns.tryWritePort(this.portNumber, payload);
    if (!success) {
      this.ns.print(`[LOGGER-CLIENT WARN] Port ${this.portNumber} ist voll! Log verworfen.`);
    }
  }

  public debug(msg: string, target?: string, context?: LoggerContext): void { this.send("DEBUG", msg, target, context); }
  public info(msg: string, target?: string, context?: LoggerContext): void { this.send("INFO", msg, target, context); }
  public success(msg: string, target?: string, context?: LoggerContext): void { this.send("SUCCESS", msg, target, context); }
  public warn(msg: string, target?: string, context?: LoggerContext): void { this.send("WARN", msg, target, context); }
  public error(msg: string, target?: string, context?: LoggerContext): void { this.send("ERROR", msg, target, context); }
}