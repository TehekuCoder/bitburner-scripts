import { LogLevel } from "shared/types/logger";
import { ANSI_COLORS } from "./colors";

export const LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  SUCCESS: 1,
  WARN: 2,
  ERROR: 3,
};

export const COLOR = ANSI_COLORS;