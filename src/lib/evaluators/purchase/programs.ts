// lib/evaluators/programs.ts
import { NS, ProgramName } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/lib/types/finance.js";
import { hasSingularity } from "/lib/utils.js";
import { runEvaluator } from "/lib/evaluator-runner.js";

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
            script: "core/actions/act-singularity.js",
            args: ["program-purchase-tor"],
          },
        });
      }
      return requests;
    }

    // 2. Darkweb-Programme evaluieren
    for (const [prog, meta] of Object.entries(PROGRAM_GATES) as [
      ProgramName,
      ProgramMeta,
    ][]) {
      if (!meta) continue;

      // Überspringen, falls das Programm bereits auf home existiert
      if (ns.fileExists(prog, "home")) continue;

      if (currentHacking < meta.reqHacking) continue;

      const cost = ns.singularity.getDarkwebProgramCost(prog);
      if (cost > 0 && Number.isFinite(cost)) {
        requests.push({
          id: `program-${prog}`,
          category: "DARKNET_PROGRAM" as PurchaseCategory,
          priority: meta.priority,
          score: meta.score,
          cost,
          description: `Software: ${prog}`,
          action: {
            script: "core/actions/act-singularity.js",
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