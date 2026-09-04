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

// Reihenfolge der Port-Opener (1 bis 5 benötigte Ports)
const PORT_OPENERS: ProgramName[] = [
  "BruteSSH.exe",
  "FTPCrack.exe",
  "relaySMTP.exe",
  "HTTPWorm.exe",
  "SQLInject.exe",
];

const UTILITY_SCORES: Partial<
  Record<ProgramName, { score: number; basePriority: PurchasePriority }>
> = {
  "DarkscapeNavigator.exe": { score: 85, basePriority: PurchasePriority.HIGH },
  "Formulas.exe": { score: 85, basePriority: PurchasePriority.HIGH },
  "ServerProfiler.exe": { score: 20, basePriority: PurchasePriority.LOW },
  "DeepscanV1.exe": { score: 30, basePriority: PurchasePriority.LOW },
  "DeepscanV2.exe": { score: 25, basePriority: PurchasePriority.LOW },
  "AutoLink.exe": { score: 35, basePriority: PurchasePriority.LOW },
};

interface ProgramScanCache {
  maxPortsNeeded: number;
  lastHackingLevel: number;
  lastScanTime: number;
}

const g = globalThis as unknown as { __programScanCache?: ProgramScanCache };
g.__programScanCache ??= {
  maxPortsNeeded: 0,
  lastHackingLevel: -1,
  lastScanTime: 0,
};

/**
 * Scannt das Netzwerk mit Caching (Trigger: Hacking-Level Aufstieg oder 30s TTL).
 */
function getTargetPortRequirement(ns: NS, playerHacking: number): number {
  const cache = g.__programScanCache!;
  const now = Date.now();
  const CACHE_TTL_MS = 30_000; // 30 Sekunden Cache-Dauer

  // Cache-Hit: Hacking-Level unverändert und TTL nicht abgelaufen
  if (
    cache.lastHackingLevel === playerHacking &&
    now - cache.lastScanTime < CACHE_TTL_MS
  ) {
    return cache.maxPortsNeeded;
  }

  // Cache-Miss: Netzwerk scannen
  const visited = new Set<string>();
  const queue: string[] = ["home"];
  let maxNeededPorts = 0;

  while (queue.length > 0) {
    const host = queue.shift()!;
    if (visited.has(host)) continue;
    visited.add(host);

    if (host !== "home" && !host.startsWith("pserv-")) {
      const reqHacking = ns.getServerRequiredHackingLevel(host);
      const reqPorts = ns.getServerNumPortsRequired(host);

      if (reqHacking <= playerHacking) {
        if (reqPorts > maxNeededPorts) {
          maxNeededPorts = reqPorts;
        }
      }
    }

    for (const neighbor of ns.scan(host)) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  // Cache aktualisieren
  cache.maxPortsNeeded = maxNeededPorts;
  cache.lastHackingLevel = playerHacking;
  cache.lastScanTime = now;

  return maxNeededPorts;
}

export const ProgramEvaluator: PurchaseEvaluator = {
  category: "DARKNET_PROGRAM" as PurchaseCategory,

  getRequests(ns: NS): PurchaseRequest[] {
    const requests: PurchaseRequest[] = [];
    if (!hasSingularity(ns)) return requests;

    const playerMoney = ns.getServerMoneyAvailable("home");
    const currentHacking = ns.getPlayer().skills.hacking;

    // 1. TOR-Router kaufen
    if (!ns.hasTorRouter()) {
      if (playerMoney >= 200_000) {
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

    // 2. Dynamische Bedarfsanalyse für Port-Opener
    const maxPortsNeeded = getTargetPortRequirement(ns, currentHacking);

    PORT_OPENERS.forEach((prog, index) => {
      if (ns.fileExists(prog, "home")) return;

      const neededPortIndex = index + 1; // 1-based (1 = BruteSSH, 2 = FTPCrack, ...)
      const cost = ns.singularity.getDarkwebProgramCost(prog);

      if (cost <= 0 || !Number.isFinite(cost)) return;

      // Wenn Server mit diesem Port-Bedarf JETZT gehackt werden können -> CRITICAL
      // Ansonsten HIGH (für den nächsten Schritt) oder LOW
      let priority = PurchasePriority.LOW;
      let score = 50 - index * 5;

      if (neededPortIndex <= maxPortsNeeded) {
        priority = PurchasePriority.CRITICAL;
        score = 95 - index * 2;
      } else if (neededPortIndex === maxPortsNeeded + 1) {
        priority = PurchasePriority.HIGH;
        score = 75;
      }

      // Notbremse bei Geldmangel
      if (priority === PurchasePriority.HIGH && cost > playerMoney * 0.4) {
        priority = PurchasePriority.MEDIUM;
      }

      requests.push({
        id: `program-${prog}`,
        category: "DARKNET_PROGRAM" as PurchaseCategory,
        priority,
        score,
        cost,
        description: `Port Opener (${neededPortIndex} Ports): ${prog}`,
        action: {
          script: PATHS.app.actions.singularity,
          args: ["program-purchase", prog],
        },
      });
    });

    // 3. Utility-Programme evaluieren (Formulas, DarkscapeNavigator, etc.)
    for (const [prog, meta] of Object.entries(UTILITY_SCORES) as [
      ProgramName,
      { score: number; basePriority: PurchasePriority },
    ][]) {
      if (ns.fileExists(prog, "home")) continue;

      const cost = ns.singularity.getDarkwebProgramCost(prog);
      if (cost <= 0 || !Number.isFinite(cost)) continue;

      let priority = meta.basePriority;

      // Formulas.exe gesondert abfedern
      if (prog === "Formulas.exe" && playerMoney < cost * 2) {
        priority = PurchasePriority.LOW;
      }

      // DarkscapeNavigator / teure Utilities herunterstufen, wenn zu teuer
      if (cost > playerMoney * 0.3 && priority !== PurchasePriority.LOW) {
        priority = PurchasePriority.MEDIUM;
      }

      requests.push({
        id: `program-${prog}`,
        category: "DARKNET_PROGRAM" as PurchaseCategory,
        priority,
        score: meta.score,
        cost,
        description: `Utility Software: ${prog}`,
        action: {
          script: PATHS.app.actions.singularity,
          args: ["program-purchase", prog],
        },
      });
    }

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, ProgramEvaluator);
}
