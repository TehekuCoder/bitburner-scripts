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
  logger?: Logger,
): Promise<string | null> {
  const logInfo = (msg: string) => (logger ? logger.info(msg) : ns.print(msg));
  const logWarn = (msg: string) => (logger ? logger.warn(msg) : ns.print(msg));
  const logError = (msg: string) =>
    logger ? logger.error(msg) : ns.print(msg);

  const cleanType = normalizeType(serverType);
  if (!cleanType) {
    logError(
      `🔴 [Manager] Kein gültiger serverType für Host '${host}' übergeben.`,
    );
    return null;
  }
  // In runSolver (solveManager.ts)
  logInfo(
    `🚀 Starte Solver '${cleanType}' für Host '${host}' mit Details: ${JSON.stringify(details)}`,
  );
  let solver = SOLVER_REGISTRY[cleanType];

  if (!solver) {
    const matchedKey = Object.keys(SOLVER_REGISTRY).find((key) =>
      cleanType.includes(key),
    );
    if (matchedKey) {
      solver = SOLVER_REGISTRY[matchedKey];
      logInfo(
        `ℹ️ [Manager] Unscharfer Match für '${serverType}': Nutze '${matchedKey}'.`,
      );
    }
  }

  if (!solver) {
    logWarn(
      `⚠️ Kein passender Solver für Typ '${serverType}' (normalisiert: '${cleanType}') registriert.`,
    );
    return null;
  }


  try {
    const password = await solver(ns, host, details);

    if (password !== null) {
      logInfo(`🎉 [Success] ${host} geknackt! Passwort: ${password}`);
      return password;
    } else {
      logWarn(
        `❌ [Failed] Solver für ${host} lief durch, konnte aber kein Passwort ermitteln.`,
      );
    }
  } catch (error: any) {
    logError(
      `🔴 [Error] Schwerer Fehler im Solver für ${host}: ${error?.message || error}`,
    );
  }

  return null;
}
