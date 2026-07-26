import { NS } from "@ns";
import { LogLevel, LogPayload } from "lib/types.js";
import { LOG_PORT } from "lib/constants.js";

export class LoggerClient {
  private ns: NS;
  private moduleName: string;
  private portNumber: number; // In TypeScript nutzen wir 'number' statt 'int'

  constructor(ns: NS, moduleName: string, portNumber = LOG_PORT) {
    this.ns = ns;
    this.moduleName = moduleName.toUpperCase();
    this.portNumber = portNumber;
  }

  private send(level: LogLevel, msg: string): void {
    const payload: LogPayload = {
      module: this.moduleName,
      level,
      msg,
      timestamp: Date.now(), // Nur Timestamp speichern, keine String-Formatierung im Hot-Loop
    };

    // Fast-Path: Bipolarer Schreibversuch in den RAM-Port
    const success = this.ns.tryWritePort(this.portNumber, payload);

    if (!success) {
      // Fallback falls der Port voll ist (Port-Queue überlaufen)
      this.ns.print(`[LOGGER-CLIENT WARN] Port ${this.portNumber} ist voll! Log verworfen.`);
    }
  }

  public debug(msg: string): void { this.send("DEBUG", msg); }
  public info(msg: string): void { this.send("INFO", msg); }
  public success(msg: string): void { this.send("SUCCESS", msg); }
  public warn(msg: string): void { this.send("WARN", msg); }
  public error(msg: string): void { this.send("ERROR", msg); }
}