import { LogLevel } from "../types/logger";

export const LOG_PORT = 1;
export const STATE_PORT = 2;

export const LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  SUCCESS: 1,
  WARN: 2,
  ERROR: 3,
};

export const COLOR = {
  RESET: "\u001b[0m",
  RED: "\u001b[31m",
  GREEN: "\u001b[32m",
  YELLOW: "\u001b[33m",
  CYAN: "\u001b[36m",
  GRAY: "\u001b[90m",
  BOLD: "\u001b[1m",
} as const;