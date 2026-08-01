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