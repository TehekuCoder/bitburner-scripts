import { NS } from "@ns";
import { LoggerClient as Logger } from "/lib/logger-client.js";

import { solveAccountsManager } from "./solveAccountsManager";
import { solveAnagram } from "./solveAnagram";
import { solveOctantVoxel } from "./solveOctantVoxel";
import { solveCloudBlare } from "./solveCloudBlare";
import { solveDeepGreen } from "./solveDeepGreen";
import { solveDeskMemo } from "./solveDeskMemo";
import { solveFactoriOs } from "./solveFactoriOs";
import { solveFreshInstall } from "./solveFreshInstall";
import { solveLaika4 } from "./solveLaika4";
import { solveNIL } from "./solveNIL";
import { solveOpenWebAccessPoint } from "./solveOpenWebAccessPoint";
import { solvePHP54 } from "./solvePHP54";
import { solvePr0verFl0 } from "./solvePr0verFl0";
import { solveRoman } from "./solveRoman";
import { solveZeroLogon } from "./solveZeroLogon";
import { SolverFunction } from "/lib/types";

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
  zerologon: solveZeroLogon,
  php54: solvePHP54,
};

function normalizeType(type?: string): string {
  return (type || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export async function runSolver(
  ns: NS,
  host: string,
  serverType: string,
  details: any,
  parentLogger?: Logger,
): Promise<string | null> {
  // ⚡ GANZ WICHTIG: Wenn kein Logger übergeben wurde, erstelle sofort einen temporären
  // LoggerClient mit PID & Host. Dadurch landest du IMMER im sys-logger!
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

  logger.info(
    `🚀 Starte Solver '${cleanType}' für Host '${host}' mit Details: ${JSON.stringify(details)}`,
  );
  let solver = SOLVER_REGISTRY[cleanType];

  if (!solver) {
    const matchedKey = Object.keys(SOLVER_REGISTRY).find((key) =>
      cleanType.includes(key),
    );
    if (matchedKey) {
      solver = SOLVER_REGISTRY[matchedKey];
      logger.info(
        `ℹ️ Unscharfer Match für '${serverType}': Nutze '${matchedKey}'.`,
      );
    }
  }

  if (!solver) {
    logger.warn(
      `⚠️ Kein passender Solver für Typ '${serverType}' (normalisiert: '${cleanType}') registriert.`,
    );
    return null;
  }

  try {
    // Erstelle für den konkreten Solver einen Unter-Logger
    const solverLogger = logger.child(cleanType);
    const password = await solver(ns, host, details, solverLogger);

    if (password !== null) {
      logger.timeEnd(timerName, "SUCCESS");
      logger.success(`🎉 [Success] ${host} geknackt! Passwort: ${password}`);
      return password;
    } else {
      logger.timeEnd(timerName, "WARN");
      logger.warn(
        `❌ [Failed] Solver für ${host} lief durch, konnte aber kein Passwort ermitteln.`,
      );
    }
  } catch (error: any) {
    logger.timeEnd(timerName, "ERROR");
    logger.error(
      `🔴 [Error] Schwerer Fehler im Solver für ${host}: ${error?.message || error}`,
    );
  }

  return null;
}