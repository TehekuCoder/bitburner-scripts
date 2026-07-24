import { NS, BitNodeMultipliers } from "@ns";
import { DEFAULT_MULTIPLIERS } from "lib/constants";
import { Logger } from "/lib/logger.js";
import { BotState } from "lib/types.js";

export function loadBnMults(ns: NS): Record<keyof BitNodeMultipliers, number> {
  if (ns.fileExists("bn-multipliers.txt", "home")) {
    try {
      const fileContent = ns.read("bn-multipliers.txt");
      if (fileContent) {
        return { ...DEFAULT_MULTIPLIERS, ...JSON.parse(fileContent) };
      }
    } catch {
      ns.print(
        "⚠️ [LIB] Fehler beim Parsen der bn-multipliers.txt. Nutze harten FailSafe.",
      );
    }
  }
  return DEFAULT_MULTIPLIERS;
}

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

function isPortEmpty(data: unknown): boolean {
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

  const baseState: Omit<BotState, "lastUpdate" | "playerHacking" | "sources"> =
    {
      strategy: "MONEY",
      progressBar: "Prüfe System...",
      batcherProgress: "Inaktiv",
      batcherActive: false,
      financeProgress: "Berechne Budget...",
      traderProgress: "Kein Depot",
      hacknetProgress: "Inaktiv",
      sleeveProgress: "Inaktiv",

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

  // Atomares Überschreiben: erst leeren, wenn wir schreibbereit sind
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
