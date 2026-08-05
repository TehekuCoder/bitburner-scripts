import { NS, ProgramName } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/lib/types/finance.js";
import {
  hasSingularity,
  loadBnMults,
  adjustPriorityByMult,
} from "/lib/utils.js";
import { runEvaluator } from "/lib/evaluator-runner.js";

const PROGRAM_GATES: Record<
  string,
  { reqHacking: number; priority: PurchasePriority; score: number }
> = {
  "BruteSSH.exe": {
    reqHacking: 50,
    priority: PurchasePriority.CRITICAL,
    score: 95,
  },
  "FTPCrack.exe": {
    reqHacking: 150,
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

    const bnMults = loadBnMults(ns);
    const darkwebMult =
      (bnMults as Record<string, number>).DarkwebSoftCost ?? 1.0;
    const efficiencyMult = darkwebMult > 0 ? 1 / darkwebMult : 1.0;

    const currentHacking = ns.getPlayer().skills.hacking;

    if (!ns.hasTorRouter()) {
      if (currentHacking >= 40) {
        const priority = adjustPriorityByMult(
          PurchasePriority.CRITICAL,
          efficiencyMult,
        );
        const score = Math.max(1, Math.floor(100 * efficiencyMult));

        requests.push({
          id: "tor-router",
          category: "DARKNET_PROGRAM" as PurchaseCategory,
          priority,
          score,
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

    for (const prog of Object.keys(PROGRAM_GATES) as ProgramName[]) {
      const meta = PROGRAM_GATES[prog];

      if (currentHacking < meta.reqHacking) continue;

      const cost = ns.singularity.getDarkwebProgramCost(prog);
      if (cost > 0 && Number.isFinite(cost)) {
        const priority = adjustPriorityByMult(meta.priority, efficiencyMult);
        const score = Math.max(1, Math.floor(meta.score * efficiencyMult));

        requests.push({
          id: `program-${prog}`,
          category: "DARKNET_PROGRAM" as PurchaseCategory,
          priority,
          score,
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
