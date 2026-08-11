import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { SolverFunction } from "/lib/types/common";

import { solveAccountsManager } from "./solveAccountsManager";
import { solveAnagram } from "./solveAnagram";
import { solveCloudBlare } from "./solveCloudBlare";
import { solveDeepGreen } from "./solveDeepGreen";
import { solveDeskMemo } from "./solveDeskMemo";
import { solveFactoriOs } from "./solveFactoriOs";
import { solveFreshInstall } from "./solveFreshInstall";
import { solveLaika4 } from "./solveLaika4";
import { solveNIL } from "./solveNIL";
import { solveOctantVoxel } from "./solveOctantVoxel";
import { solveOpenWebAccessPoint } from "./solveOpenWebAccessPoint";
import { solvePHP54 } from "./solvePHP54";
import { solvePr0verFl0 } from "./solvePr0verFl0";
import { solveRoman } from "./solveRoman";
import { solveZeroLogon } from "./solveZeroLogon";

const SOLVER_REGISTRY: Record<string, SolverFunction> = {
  accountsmanager: solveAccountsManager,
  anagram: solveAnagram,
  octantvoxel: solveOctantVoxel,
  cloudblare: solveCloudBlare,
  cloudblaretm: solveCloudBlare,
  deepgreen: solveDeepGreen,
  deskmemo: solveDeskMemo,
  factorios: solveFactoriOs,
  freshinstall: solveFreshInstall,
  laika4: solveLaika4,
  nil: solveNIL,
  openwebaccesspoint: solveOpenWebAccessPoint,
  pr0verfl0: solvePr0verFl0,
  bellacuore: solveRoman,
  roman: solveRoman,
  zerologon: solveZeroLogon,
  php54: solvePHP54,
};

function normalizeType(type?: string): string {
  return (type || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/** Findet den passenden Solver – bei Teiltreffern gewinnt die längste Übereinstimmung */
function findSolver(cleanType: string): { solver: SolverFunction; matchedKey: string } | null {
  if (SOLVER_REGISTRY[cleanType]) {
    return { solver: SOLVER_REGISTRY[cleanType], matchedKey: cleanType };
  }

  const matches = Object.keys(SOLVER_REGISTRY)
    .filter((key) => cleanType.includes(key))
    .sort((a, b) => b.length - a.length);

  if (matches.length > 0) {
    const bestKey = matches[0];
    return { solver: SOLVER_REGISTRY[bestKey], matchedKey: bestKey };
  }

  return null;
}

export async function runSolver(
  ns: NS,
  host: string,
  serverType: string,
  details: any,
  parentLogger?: Logger,
): Promise<string | null> {
  const logger = parentLogger
    ? parentLogger.child("MANAGER", { serverType })
    : new Logger(ns, "SOLVER-MANAGER", host, "DEBUG", undefined, { serverType });

  const timerName = `solve-${host}`;
  logger.time(timerName);

  const cleanType = normalizeType(serverType);
  if (!cleanType) {
    logger.error(`🔴 Kein gültiger serverType für Host '${host}' übergeben.`);
    return null;
  }

  let safeDetailsDump = "N/A";
  try {
    safeDetailsDump = JSON.stringify(details);
  } catch {
    safeDetailsDump = "[Unserializable Object]";
  }

  logger.info(`🚀 Starte Solver für '${cleanType}' auf Host '${host}'. Details: ${safeDetailsDump}`);

  const match = findSolver(cleanType);
  if (!match) {
    logger.warn(`⚠️ Kein passender Solver für Typ '${serverType}' (normalisiert: '${cleanType}') registriert.`);
    return null;
  }

  const { solver, matchedKey } = match;
  if (matchedKey !== cleanType) {
    logger.info(`ℹ️ Unscharfer Match für '${serverType}': Nutze '${matchedKey}'.`);
  }

  try {
    const solverLogger = logger.child(matchedKey);
    const password = await solver(ns, host, details, solverLogger);

    if (password !== null) {
      logger.timeEnd(timerName, "SUCCESS");
      logger.success(`🎉 [Success] ${host} geknackt! Passwort: ${password}`);
      return password;
    } else {
      logger.timeEnd(timerName, "WARN");
      logger.warn(`❌ [Failed] Solver für ${host} lief durch, konnte aber kein Passwort ermitteln.`);
    }
  } catch (error: any) {
    logger.timeEnd(timerName, "ERROR");
    logger.error(`🔴 [Error] Schwerer Fehler im Solver für ${host}: ${error?.message || error}`);
  }

  return null;
}