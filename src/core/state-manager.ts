import { NS, FactionName, CompanyName, JobField } from "@ns";
import { Logger } from "./logger.js";
import {BotState} from "core/types.js"

const STATE_PORT = 1;

let _logger: Logger | null = null;
function getLogger(ns: NS): Logger {
  if (!_logger) _logger = new Logger(ns, "State", "INFO");
  return _logger;
}

function getCallerName(ns: NS): string {
  const path = ns.getScriptName();
  return path.split("/").pop() || "unknown";
}

function isPortEmpty(data: any): boolean {
  return (
    data === undefined ||
    data === null ||
    data === "NULL PORT DATA" ||
    data === "NULL"
  );
}

export function saveState(
  ns: NS,
  state: Omit<BotState, "lastUpdate" | "playerHacking" | "sources">,
): void {
  try {
    const port = ns.getPortHandle(STATE_PORT);
    const caller = getCallerName(ns);

    const sources: Record<string, string> = {};
    for (const key of Object.keys(state)) {
      sources[key] = caller;
    }

    const fullState: BotState = {
      ...state,
      sources,
      lastUpdate: Date.now(),
      playerHacking: ns.getHackingLevel(),
    };

    port.clear();
    port.write(fullState);
  } catch (error) {
    getLogger(ns).error(
      `Zustand konnte nicht in Port geschrieben werden: ${error}`,
    );
  }
}

export function patchState(
  ns: NS,
  partialState: Partial<
    Omit<BotState, "lastUpdate" | "playerHacking" | "sources">
  >,
): void {
  const port = ns.getPortHandle(STATE_PORT);
  const data = port.peek();
  let currentState: BotState | null = null;

  if (!isPortEmpty(data)) {
    currentState = data as BotState;
  }

  const {
    lastUpdate,
    playerHacking,
    sources: oldSources,
    ...cleanedCurrentState
  } = currentState || {};

  // Default-Werte für Progression, damit keine "undefined"-Fehler auftreten
  const baseState: Omit<BotState, "lastUpdate" | "playerHacking" | "sources"> =
    {
      strategy: "MONEY",
      progressBar: "Prüfe System...",
      batcherProgress: "Inaktiv",
      batcherActive: false,
      financeProgress: "Berechne Budget...",
      traderProgress: "Kein Depot",
      hacknetProgress: "Inaktiv",
      sleeveProgress: "Inaktiv", // 🟢 NEU: Verhindert undefined-Fehler beim ersten Start

      // Standatmuster für Progression
      currentBitNode: 1,
      currentBitNodeLevel: 1,
      sourceFiles: {},
      hasDarkScapeNavigator: false,
      hasTorRouter: false,
      hasGang: false,
      hasCorporation: false,
      hasBladeburner: false,

      ...cleanedCurrentState,
    };

  const caller = getCallerName(ns);
  const newSources = { ...(oldSources || {}) };
  for (const key of Object.keys(partialState)) {
    newSources[key] = caller;
  }

  const fullState: BotState = {
    ...baseState,
    ...partialState,
    sources: newSources,
    lastUpdate: Date.now(),
    playerHacking: ns.getHackingLevel(),
  };

  port.clear();
  port.write(fullState);
}

export function loadState(ns: NS): BotState | null {
  try {
    const port = ns.getPortHandle(STATE_PORT);
    const data = port.peek();

    if (isPortEmpty(data)) {
      return null;
    }

    return data as BotState;
  } catch (error) {
    getLogger(ns).error(
      `Port ${STATE_PORT} konnte nicht gelesen werden: ${error}`,
    );
    return null;
  }
}

export function clearState(ns: NS): void {
  ns.getPortHandle(STATE_PORT).clear();
  getLogger(ns).info(`Port ${STATE_PORT} erfolgreich geleert.`);
}
