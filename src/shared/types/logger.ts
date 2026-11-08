export type LogLevel = "DEBUG" | "INFO" | "SUCCESS" | "WARN" | "ERROR";

export interface LoggerContext {
  target?: string;
  tags?: string[];
  context?: Record<string, string | number | boolean | null | undefined>;
}

export interface LogPayload {
  module: string;
  level: LogLevel;
  msg: string;
  timestamp: number;
  target?: string;
  tags?: string[];
  context?: Record<string, string | number | boolean | null | undefined>;
}

const LOG_LEVELS: readonly LogLevel[] = [
  "DEBUG",
  "INFO",
  "SUCCESS",
  "WARN",
  "ERROR",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContext(
  value: unknown,
): value is Record<string, string | number | boolean | null | undefined> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(
    (entry) =>
      entry === undefined ||
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry)),
  );
}

export function isLogPayload(value: unknown): value is LogPayload {
  if (!isRecord(value)) return false;

  return (
    typeof value.module === "string" &&
    value.module.trim().length > 0 &&
    typeof value.level === "string" &&
    LOG_LEVELS.includes(value.level as LogLevel) &&
    typeof value.msg === "string" &&
    typeof value.timestamp === "number" &&
    Number.isFinite(value.timestamp) &&
    value.timestamp >= 0 &&
    value.timestamp <= 8.64e15 &&
    (value.target === undefined || typeof value.target === "string") &&
    (value.tags === undefined ||
      (Array.isArray(value.tags) &&
        value.tags.every((tag) => typeof tag === "string"))) &&
    (value.context === undefined || isContext(value.context))
  );
}
