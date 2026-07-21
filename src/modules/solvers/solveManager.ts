import { NS } from "@ns";
import { SolverFunction } from "/core/types";

import { solveAccountsManager } from "/modules/solvers/solveAccountsManager";
import { solveAnagram } from "/modules/solvers/solveAnagram";
import { solveBaseConversion } from "/modules/solvers/solveBaseConversion";
import { solveCloudBlare } from "/modules/solvers/solveCloudBlare";
import { solveDeepGreen } from "/modules/solvers/solveDeepGreen";
import { solveDeskMemo } from "/modules/solvers/solveDeskMemo";
import { solveFactoriOs } from "/modules/solvers/solveFactoriOs";
import { solveFreshInstall } from "/modules/solvers/solveFreshInstall";
import { solveLaika4 } from "/modules/solvers/solveLaika4";
import { solveNIL } from "/modules/solvers/solveNIL";
import { solveOpenWebAccessPoint } from "/modules/solvers/solveOpenWebAccessPoint";
import { solvePr0verFl0 } from "/modules/solvers/solvePr0verFl0";
import { solveRoman } from "/modules/solvers/solveRoman";
import { solveZeroLogon } from "/modules/solvers/solveZeroLogon";
import { solvePHP54 } from "/modules/solvers/solvePHP54";

// Die Keys entsprechen exakt den Server-Typen, wie sie im Spiel definiert sind
const SOLVER_REGISTRY: Record<string, SolverFunction> = {
  accountsmanager: solveAccountsManager,
  anagram: solveAnagram,
  octantvoxel: solveBaseConversion,
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

/**
 * Normalisiert den Server-Typnamen, um Schreibfehler und Sonderzeichen abzufangen.
 * Null-Safe: Verhindert TypeError, falls 'type' undefined ist.
 */
function normalizeType(type?: string): string {
  return (type || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Der zentrale Manager. Holt sich den passenden Solver für den Server-Typ
 * und führt ihn sicher aus.
 *
 * @returns Das erfolgreiche Passwort (string) oder null bei Fehlschlag.
 */
export async function runSolver(
  ns: NS,
  host: string,
  serverType: string,
  details: any,
): Promise<string | null> {
  const cleanType = normalizeType(serverType);
  if (!cleanType) {
    ns.print(
      `🔴 [Manager] Kein gültiger serverType für Host '${host}' übergeben.`,
    );
    return null;
  }

  // 1. Exakter Match
  let solver = SOLVER_REGISTRY[cleanType];

  // 2. Fuzzy Match: Falls Modellnamen Versionen enthalten (z. B. "accountsmanagerv2")
  if (!solver) {
    const matchedKey = Object.keys(SOLVER_REGISTRY).find((key) =>
      cleanType.includes(key),
    );
    if (matchedKey) {
      solver = SOLVER_REGISTRY[matchedKey];
      ns.print(
        `ℹ️ [Manager] Unscharfer Match für '${serverType}': Nutze '${matchedKey}'.`,
      );
    }
  }

  if (!solver) {
    ns.print(
      `⚠️ Kein passender Solver für Typ '${serverType}' (normalisiert: '${cleanType}') registriert.`,
    );
    return null;
  }

  ns.print(`🚀 Starte Solver '${cleanType}' für Host '${host}'...`);

  try {
    const password = await solver(ns, host, details);

    if (password !== null) {
      ns.print(`🎉 [Success] ${host} geknackt! Passwort: ${password}`);
      return password;
    } else {
      ns.print(
        `❌ [Failed] Solver für ${host} lief durch, konnte aber kein Passwort ermitteln.`,
      );
    }
  } catch (error: any) {
    ns.print(
      `🔴 [Error] Schwerer Fehler im Solver für ${host}: ${error?.message || error}`,
    );
  }

  return null;
}
