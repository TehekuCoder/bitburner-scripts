import { NS } from "@ns";
import { LogPayload } from "lib/types.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail(); // Sendet Logs ins eigene Fenster

  const PORT_NUM = (ns.args[0] as number) || 1;
  const LOG_FILE = "/logs/bitos_system.txt";
  const BACKUP_FILE = "/logs/bitos_system_old.txt";
  const MAX_LOG_SIZE = 100_000; // ~100 KB
  const FLUSH_INTERVAL_MS = 200; // Alle 200ms gesammelt schreiben

  const port = ns.getPortHandle(PORT_NUM);
  let currentFileSize = ns.fileExists(LOG_FILE, "home") ? ns.read(LOG_FILE).length : 0;
  let buffer: string[] = [];

  ns.print(`[SYS-LOGGER] 🎧 Daemon gestartet auf Port ${PORT_NUM}. Logfile: ${LOG_FILE}`);

  while (true) {
    // 1. Port leerpumpen und im RAM verarbeiten
    while (!port.empty()) {
      const payload = port.read() as LogPayload;
      if (!payload || !payload.module) continue;

      const formatted = formatMessage(payload);
      ns.print(formatted); // Terminal-Output des Loggers
      buffer.push(formatted);
    }

    // 2. Buffer verarbeiten (falls Einträge vorhanden sind)
    if (buffer.length > 0) {
      const chunk = buffer.join("\n") + "\n";
      buffer = [];

      // Log-Rotation prüfen
      if (currentFileSize + chunk.length > MAX_LOG_SIZE) {
        if (ns.fileExists(LOG_FILE, "home")) {
          const content = ns.read(LOG_FILE);
          ns.write(BACKUP_FILE, content, "w");
        }
        ns.write(LOG_FILE, "", "w");
        currentFileSize = 0;
        ns.print(`[SYS-LOGGER] 🔄 Log-Rotation durchgeführt.`);
      }

      // Einzelner Datei-Schreibaufruf für das gesamte Intervall
      ns.write(LOG_FILE, chunk, "a");
      currentFileSize += chunk.length;
    }

    // 3. Dem Event-Loop Zeit zum Atmen geben
    await ns.asleep(FLUSH_INTERVAL_MS);
  }
}

/**
 * Entkoppelte Datums-Formatierung im Daemon
 */
function formatMessage(p: LogPayload): string {
  const d = new Date(p.timestamp);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  
  return `[${hh}:${mm}:${ss}.${ms}] [${p.level.padEnd(7)}] [${p.module}] ${p.msg}`;
}