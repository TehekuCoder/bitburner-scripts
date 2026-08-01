// lib/evaluators/program.ts
import { NS, ProgramName } from "@ns";
import { PurchaseEvaluator, PurchaseRequest, PurchasePriority } from "/lib/types/finance.js";
import { runEvaluator } from "/lib/evaluator-runner.js";

const PROGRAM_GATES: Record<string, { reqHacking: number; priority: PurchasePriority; score: number }> = {
  "BruteSSH.exe":    { reqHacking: 50,  priority: PurchasePriority.CRITICAL, score: 95 },
  "FTPCrack.exe":    { reqHacking: 150, priority: PurchasePriority.CRITICAL, score: 90 },
  "relaySMTP.exe":   { reqHacking: 250, priority: PurchasePriority.HIGH,     score: 85 },
  "HTTPWorm.exe":    { reqHacking: 350, priority: PurchasePriority.HIGH,     score: 80 },
  "SQLInject.exe":   { reqHacking: 500, priority: PurchasePriority.HIGH,     score: 75 },
  "Formulas.exe":    { reqHacking: 0,   priority: PurchasePriority.MEDIUM,   score: 60 },
};

export const ProgramEvaluator: PurchaseEvaluator = {
  category: "DARKNET_PROGRAM",

  getRequests(ns: NS): PurchaseRequest[] {
    const requests: PurchaseRequest[] = [];
    if (!ns.singularity) return requests;

    const currentHacking = ns.getPlayer().skills.hacking;

    if (!ns.hasTorRouter()) {
      if (currentHacking >= 40) {
        requests.push({
          id: "tor-router",
          category: "DARKNET_PROGRAM",
          priority: PurchasePriority.CRITICAL,
          score: 100, // Höchste Prio: Ohne TOR kein Darkweb
          cost: 200_000,
          description: "TOR Router purchase",
          action: {
            script: "core/actions/act-singularity.js",
            args: ["program-purchase-tor"],
          },
        });
      }
    }

    for (const prog of Object.keys(PROGRAM_GATES) as ProgramName[]) {
      const meta = PROGRAM_GATES[prog];
      const cost = ns.singularity.getDarkwebProgramCost(prog);
      if (cost > 0 && Number.isFinite(cost)) {
        requests.push({
          id: `program-${prog}`,
          category: "DARKNET_PROGRAM",
          priority: meta.priority,
          score: meta.score,
          cost: cost,
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