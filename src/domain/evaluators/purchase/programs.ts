// lib/evaluators/programs.ts
import { NS, ProgramName } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/shared/types/finance.js";
import { hasSingularity } from "/lib/utils.js";
import { runEvaluator } from "../evaluator-runner.js";
import { PATHS } from "/infrastructure/runtime/paths";

type ProgramMeta = {
  reqHacking: number;
  priority: PurchasePriority;
  score: number;
};

const PROGRAM_GATES: Partial<Record<ProgramName, ProgramMeta>> = {
  "BruteSSH.exe": {
    reqHacking: 50,
    priority: PurchasePriority.CRITICAL,
    score: 95,
  },
  "FTPCrack.exe": {
    reqHacking: 100,
    priority: PurchasePriority.CRITICAL,
    score: 90,
  },
  "relaySMTP.exe": {
    reqHacking: 250,
    priority: PurchasePriority.HIGH,
    score: 85,
  },
  "HTTPWorm.exe": {
    reqHacking: 350,
    priority: PurchasePriority.HIGH,
    score: 80,
  },
  "SQLInject.exe": {
    reqHacking: 500,
    priority: PurchasePriority.HIGH,
    score: 75,
  },
  "ServerProfiler.exe": {
    reqHacking: 0,
    priority: PurchasePriority.LOW,
    score: 30,
  },
  "DeepscanV1.exe": {
    reqHacking: 0,
    priority: PurchasePriority.LOW,
    score: 40,
  },
  "DeepscanV2.exe": {
    reqHacking: 0,
    priority: PurchasePriority.LOW,
    score: 35,
  },
  "AutoLink.exe": {
    reqHacking: 0,
    priority: PurchasePriority.LOW,
    score: 40,
  },
  "DarkscapeNavigator.exe": {
    reqHacking: 0,
    priority: PurchasePriority.MEDIUM,
    score: 60,
  },
  "Formulas.exe": {
    reqHacking: 0,
    priority: PurchasePriority.MEDIUM,
    score: 60,
  },
};

export const ProgramEvaluator: PurchaseEvaluator = {
  category: "DARKNET_PROGRAM" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    const requests: PurchaseRequest[] = [];
    if (!hasSingularity(ns)) return requests;

    const currentHacking = ns.getPlayer().skills.hacking;

    // 1. TOR-Router kaufen, falls noch nicht vorhanden
    if (!ns.hasTorRouter()) {
      if (currentHacking >= 40) {
        requests.push({
          id: "tor-router",
          category: "DARKNET_PROGRAM" as PurchaseCategory,
          priority: PurchasePriority.CRITICAL,
          score: 100,
          cost: 200_000,
          description: "TOR Router purchase",
          action: {
            script: PATHS.app.actions.singularity,
            args: ["program-purchase-tor"],
          },
        });
      }
      return requests;
    }

    // 2. Darkweb-Programme evaluieren
    const playerMoney = ns.getServerMoneyAvailable("home");

    for (const [prog, meta] of Object.entries(PROGRAM_GATES) as [
      ProgramName,
      ProgramMeta,
    ][]) {
      if (
        !meta ||
        ns.fileExists(prog, "home") ||
        currentHacking < meta.reqHacking
      )
        continue;

      const cost = ns.singularity.getDarkwebProgramCost(prog);
      if (cost > 0 && Number.isFinite(cost)) {
        let priority = meta.priority;

        // Dynamische Notbremse: Wenn ein Programm mehr als 50% des aktuellen Vermögens kostet,
        // wird die Priorität gesenkt (ausgenommen BruteSSH & FTPCrack im Early-Game).
        const isEssentialEarlyPort =
          prog === "BruteSSH.exe" || prog === "FTPCrack.exe";
        if (!isEssentialEarlyPort && cost > playerMoney * 0.5) {
          priority = PurchasePriority.LOW;
        }

        // Formulas.exe gesondert behandeln (Kosten-Nutzen-Schwelle)
        if (prog === "Formulas.exe" && playerMoney < cost * 2) {
          priority = PurchasePriority.LOW;
        }

        requests.push({
          id: `program-${prog}`,
          category: "DARKNET_PROGRAM" as PurchaseCategory,
          priority,
          score: meta.score,
          cost,
          description: `Software: ${prog}`,
          action: {
            script: PATHS.app.actions.singularity,
            args: ["program-purchase", prog],
          },
        });
      }
    }

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, ProgramEvaluator);
}
