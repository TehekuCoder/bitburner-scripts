import { NS } from "@ns";
import { LogLevel, LogPayload } from "lib/types.js";
import { LEVEL_RANK } from "/lib/constants";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();

// CLI-Flags verarbeiten
  const flags = ns.flags([
    ["port", 1],
    ["target", ""], 
    ["module", ""], 
    ["level", "WARN"], 
    ["fileAll", true], 
    ["tag", ""], 
    ["context", ""], 
  ]);

  const PORT_NUM = flags.port as number;
  const LOG_FILE = "/logs/bitos_system.txt";
  const BACKUP_FILE = "/logs/bitos_system_old.txt";
  const MAX_LOG_SIZE = 100_000;
  const FLUSH_INTERVAL_MS = 200;

  // Filter-Sets aufbauen (leeres Set = alle erlaubt)
  const targetFilter = parseFilterSet(flags.target as string);
  const moduleFilter = parseFilterSet(flags.module as string);
  const tagFilter = parseFilterSet(flags.tag as string);
  const contextFilter = parseContextFilter(flags.context as string);
  const minLevelRank =
    LEVEL_RANK[(flags.level as string).toUpperCase() as LogLevel] ?? 0;
  const fileAll = flags.fileAll as boolean;

  const port = ns.getPortHandle(PORT_NUM);
  let currentFileSize = ns.fileExists(LOG_FILE, "home")
    ? ns.read(LOG_FILE).length
    : 0;
  let buffer: string[] = [];

  ns.print(`[SYS-LOGGER] 🎧 Daemon gestartet auf Port ${PORT_NUM}`);
  if (targetFilter.size > 0)
    ns.print(`🎯 Filter Ziele  : ${[...targetFilter].join(", ")}`);
  if (moduleFilter.size > 0)
    ns.print(`📦 Filter Module : ${[...moduleFilter].join(", ")}`);
  if (tagFilter.size > 0)
    ns.print(`🏷️ Filter Tags   : ${[...tagFilter].join(", ")}`);
  if (contextFilter.size > 0)
    ns.print(`🧩 Filter Context: ${[...contextFilter.entries()].map(([k,v]) => `${k}=${v}`).join(", ")}`);
  ns.print(`📊 Min Log-Level : ${flags.level}`);

  while (true) {
    while (!port.empty()) {
      const payload = port.read() as LogPayload;
      if (!payload || !payload.module) continue;

      const levelRank = LEVEL_RANK[payload.level] ?? 0;

      // Filter-Prüfungen
      const passesLevel = levelRank >= minLevelRank;
      const passesModule =
        moduleFilter.size === 0 ||
        moduleFilter.has(payload.module.toUpperCase());
      const passesTarget =
        targetFilter.size === 0 ||
        (payload.target && targetFilter.has(payload.target.toLowerCase()));

      const passesTag =
        tagFilter.size === 0 ||
        (payload.tags || []).some((tag) => tagFilter.has(tag.toLowerCase()));
      const passesContext =
        contextFilter.size === 0 ||
        [...contextFilter.entries()].every(([key, expected]) => {
          const actual = payload.context?.[key];
          return actual !== undefined && String(actual).toLowerCase() === expected.toLowerCase();
        });

      const isVisible = passesLevel && passesModule && passesTarget && passesTag && passesContext;
      const formatted = formatMessage(payload);

      // 1. UI Output nur wenn Filter matchen
      if (isVisible) {
        ns.print(formatted);
      }

      // 2. File Output (entweder alles oder nur gefilterte)
      if (fileAll || isVisible) {
        buffer.push(formatted);
      }
    }

    if (buffer.length > 0) {
      const chunk = buffer.join("\n") + "\n";
      buffer = [];

      if (currentFileSize + chunk.length > MAX_LOG_SIZE) {
        if (ns.fileExists(LOG_FILE, "home")) {
          const content = ns.read(LOG_FILE);
          ns.write(BACKUP_FILE, content, "w");
        }
        ns.write(LOG_FILE, "", "w");
        currentFileSize = 0;
        ns.print(`[SYS-LOGGER] 🔄 Log-Rotation durchgeführt.`);
      }

      ns.write(LOG_FILE, chunk, "a");
      currentFileSize += chunk.length;
    }

    await ns.asleep(FLUSH_INTERVAL_MS);
  }
}

function parseFilterSet(input: string): Set<string> {
  if (!input || input.trim() === "" || input === "*") return new Set();
  return new Set(
    input
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

function parseContextFilter(input: string): Map<string, string> {
  if (!input || input.trim() === "") return new Map();
  const result = new Map<string, string>();
  for (const part of input.split(",")) {
    const [key, ...rest] = part.split("=");
    if (!key) continue;
    result.set(key.trim().toLowerCase(), (rest.join("=") || "").trim().toLowerCase());
  }
  return result;
}

function formatMessage(p: LogPayload): string {
  const d = new Date(p.timestamp);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");

  const targetTag = p.target ? ` [${p.target.toLowerCase()}]` : "";
  const levelTag = p.level.padEnd(7);
  const tags = p.tags ?? [];
  const tagSuffix = tags.length > 0 ? ` [tags:${tags.join(",")}]` : "";
  const contextSuffix = p.context && Object.keys(p.context).length > 0
    ? ` [ctx:${Object.entries(p.context).map(([k,v]) => `${k}=${v}`).join(",")}]`
    : "";

  return `[${hh}:${mm}:${ss}.${ms}] [${levelTag}] [${p.module}]${targetTag}${tagSuffix}${contextSuffix} ${p.msg}`;
}
