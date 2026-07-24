import { NS } from "@ns";

import { solveAccountsManager } from "./solveAccountsManager";
import { solveAnagram } from "./solveAnagram";
import { solveBaseConversion } from "./solveBaseConversion";
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

  // 2. Fuzzy Match für Modell-Varianten
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