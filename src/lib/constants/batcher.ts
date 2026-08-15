export const SPACER = 125;
export const BATCH_GAP = 4 * SPACER;
export const HOME_RAM_RESERVE = 64;

export const PATH_GROW = "payloads/grow.js";
export const PATH_HACK = "payloads/hack.js";
export const PATH_WEAKEN = "payloads/weaken.js";

export const BATCHER_MIN_RAM = 1024;

export type DispatchResult = "SUCCESS" | "NO_RAM" | "EXEC_FAIL";