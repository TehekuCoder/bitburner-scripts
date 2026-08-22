import { NS } from "@ns";
import {
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/shared/types/finance.js";
import { drawFinanceDashboard, FinanceDashboardData } from "/ui/finance-ui.js";

import { loadBnMults } from "/lib/utils.js";
import { LoggerClient } from "/infrastructure/logging/logger-client";
import { FINANCE_PORT } from "../../domain/evaluators/evaluator-runner";
import { PATHS } from "/infrastructure/runtime/paths";
import {
  BASE_CATEGORY_MARGINS,
  CATEGORY_TO_EVALUATOR,
  CATEGORY_WEIGHTS,
} from "/shared/constants/finance";

interface EvaluatorCacheEntry {
  timestamp: number;
  requests: Map<string, PurchaseRequest>;
}

// Persistenten Speicher außerhalb der Hauptschleife anlegen
const evaluatorRequestCache = new Map<string, EvaluatorCacheEntry>();
const CACHE_TTL_MS = 45000; // 45s TTL für Anfragen (ausreichend Puffer für sequenzielle Zyklen)
const BATCH_GAP_MS = 3000; // Daten nach >3s als neuen Evaluator-Durchlauf werten & alte Einträge ersetzen

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new LoggerClient(ns, "FINANCE");
  ns.ui.openTail();

  ns.ui.setTailTitle("Finance-Core");
  ns.ui.resizeTail(618, 535);

  const lastPurchases: string[] = [];
  const lastWarnings: string[] = [];
  const evaluatorLastSeen: Record<string, number> = {};

  while (true) {
    const now = Date.now();
    const rawMoney = ns.getServerMoneyAvailable("home");
    let availableMoney = rawMoney;
    const bnMults = loadBnMults(ns);

    // 1. BitNode-Multiplikatoren auswerten
    const augCostMult = bnMults.AugmentationMoneyCost ?? 1.0;
    const CloudCostMult = bnMults.CloudServerCost ?? 1.0;

    const dynamicMargins: Partial<Record<PurchaseCategory, number>> = {
      ...BASE_CATEGORY_MARGINS,
      PLAYER_AUG: augCostMult > 2.0 ? 1.2 : 1.0,
      SLEEVE_AUG: augCostMult > 2.0 ? 1.2 : 1.0,
      PURCHASED_SERVER: CloudCostMult > 3.0 ? 1.15 : 1.0,
    };

    const pocketChangeRatio = augCostMult > 3.0 ? 0.002 : 0.01;

    // 2. Anfragen aus dem Port verarbeiten & in den Cache einspeisen
    const port = ns.getPortHandle(FINANCE_PORT);
    while (!port.empty()) {
      const reqData = port.read() as string;
      if (reqData !== "NULL PORT DATA") {
        try {
          const parsed = JSON.parse(reqData);

          const registerBatch = (
            reqs: PurchaseRequest[],
            cat?: PurchaseCategory,
          ) => {
            for (const req of reqs) {
              const reqCat =
                req.category || cat || ("UNKNOWN" as PurchaseCategory);
              req.category = reqCat;

              const evalName = CATEGORY_TO_EVALUATOR[reqCat];
              if (evalName) evaluatorLastSeen[evalName] = now;

              let cacheEntry = evaluatorRequestCache.get(reqCat);

              // Bei neuer Kategorie oder neuem Evaluator-Lauf (>3s Pause) alte Daten ersetzen
              if (!cacheEntry || now - cacheEntry.timestamp > BATCH_GAP_MS) {
                cacheEntry = {
                  timestamp: now,
                  requests: new Map<string, PurchaseRequest>(),
                };
                evaluatorRequestCache.set(reqCat, cacheEntry);
              }

              if (req?.id) {
                cacheEntry.requests.set(req.id, req);
                cacheEntry.timestamp = now;
              }
            }
          };

          if (
            parsed &&
            typeof parsed === "object" &&
            Array.isArray(parsed.requests)
          ) {
            registerBatch(parsed.requests, parsed.category);
          } else if (Array.isArray(parsed)) {
            registerBatch(parsed as PurchaseRequest[]);
          } else if (parsed && typeof parsed === "object") {
            registerBatch([parsed as PurchaseRequest]);
          }
        } catch (e) {
          ns.print(`[ERROR] Ungültiges JSON im Finance-Port: ${e}`);
        }
      }
    }

    // Veraltete Kategorien entfernen (TTL Check)
    for (const [cat, cache] of evaluatorRequestCache.entries()) {
      if (now - cache.timestamp > CACHE_TTL_MS) {
        evaluatorRequestCache.delete(cat);
      }
    }

    // Aktive Anfragen aus allen Caches aggregieren
    const allRequests: PurchaseRequest[] = [];
    for (const cache of evaluatorRequestCache.values()) {
      allRequests.push(...cache.requests.values());
    }

    // Status der System-Komponenten abfragen
    const homeServer = ns.getServer("home");
    const homeRamTotal = ns.getServerMaxRam("home");
    const homeRamUsed = ns.getServerUsedRam("home");
    const homeCores = homeServer.cpuCores ?? 1;

    const purchasedServerNames = ns.cloud.getServerNames();
    const purchasedServerCount = purchasedServerNames.length;
    const purchasedServerLimit = ns.cloud.getServerLimit();
    let largestPurchasedServerName = "–";
    let largestPurchasedServerRam = 0;

    for (const server of purchasedServerNames) {
      const serverRam = ns.getServerMaxRam(server);
      if (serverRam > largestPurchasedServerRam) {
        largestPurchasedServerRam = serverRam;
        largestPurchasedServerName = server;
      }
    }

    const hacknetCount = ns.hacknet.numNodes();
    const hacknetLimit = ns.hacknet.maxNumNodes();
    const isHacknetServer =
      typeof (ns.hacknet as any).hashCapacity === "function";

    const financeManagerActive = ns.isRunning(
      PATHS.services.daemons.financeDispatcher,
      "home",
    );
    const sysOrchestratorActive = ns.isRunning(
      PATHS.app.orchestration.orchestrator,
      "home",
    );

    const evaluators = [
      "home",
      "hacknet",
      "stock",
      "cloud",
      "programs",
      "gang",
      "sleeve",
      "player",
      "corporation",
    ];
    const activeEvaluators: string[] = [];
    const inactiveEvaluators: string[] = [];

    for (const name of evaluators) {
      const evaluatorPath =
        PATHS.domain.evaluators.purchase[
          name as keyof typeof PATHS.domain.evaluators.purchase
        ];
      const lastSeen = evaluatorLastSeen[name] ?? 0;
      if (
        now - lastSeen < 30000 ||
        (evaluatorPath && ns.isRunning(evaluatorPath, "home"))
      ) {
        activeEvaluators.push(name);
      } else {
        inactiveEvaluators.push(name);
      }
    }

    // 3. Sortierung der Anfragen
    if (allRequests.length > 0) {
      allRequests.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;

        const weightA = CATEGORY_WEIGHTS[a.category] ?? 0;
        const weightB = CATEGORY_WEIGHTS[b.category] ?? 0;
        if (weightA !== weightB) return weightB - weightA;

        const scoreA = a.score ?? 0;
        const scoreB = b.score ?? 0;
        if (scoreA !== scoreB) return scoreB - scoreA;

        return a.cost - b.cost;
      });

      // 4. Käufe verarbeiten
      const blockedCategories = new Set<PurchaseCategory>();
      let highestUnsatisfiedPriority = Number.MAX_SAFE_INTEGER;

      for (const req of allRequests) {
        const margin = dynamicMargins[req.category] ?? 1.0;
        const requiredBudget = req.cost * margin;

        const canAffordEasily = availableMoney >= requiredBudget;
        const isPocketChange = req.cost <= rawMoney * pocketChangeRatio;

        if (blockedCategories.has(req.category) && !canAffordEasily) {
          continue;
        }

        if (req.priority > highestUnsatisfiedPriority && !isPocketChange) {
          continue;
        }

        if (canAffordEasily) {
          const pid = ns.exec(req.action.script, "home", 1, ...req.action.args);

          if (pid > 0) {
            const purchaseMsg = `🛒 KAUF: ${req.description} ($${ns.format.number(req.cost)})`;
            logger.success(purchaseMsg);
            lastPurchases.push(purchaseMsg);
            if (lastPurchases.length > 6) lastPurchases.shift();

            // Nach erfolgreichem Kauf sofort aus dem Cache entfernen
            const cacheEntry = evaluatorRequestCache.get(req.category);
            if (cacheEntry && req.id) {
              cacheEntry.requests.delete(req.id);
            }

            availableMoney -= req.cost;
            await ns.sleep(20);
          } else {
            const errorMsg = `⚠️ Script-Start fehlgeschlagen: ${req.action.script}`;
            logger.warn(errorMsg);
            lastWarnings.push(errorMsg);
            if (lastWarnings.length > 6) lastWarnings.shift();
          }
        } else {
          const savingMsg = `⏳ SPARZIEL: ${req.description} ($${ns.format.number(availableMoney)} / $${ns.format.number(req.cost)})`;
          lastWarnings.push(savingMsg);
          if (lastWarnings.length > 6) lastWarnings.shift();

          blockedCategories.add(req.category);

          if (req.priority < highestUnsatisfiedPriority) {
            highestUnsatisfiedPriority = req.priority;
          }
        }
      }
    }

    // UI-Daten vorbereiten
    const structuredRequests = allRequests.map((req) => ({
      description: req.description,
      category: req.category,
      priorityLabel: PurchasePriority[req.priority] ?? String(req.priority),
      cost: req.cost,
      score: req.score,
    }));

    const dashboardData: FinanceDashboardData = {
      currentMoney: rawMoney,
      availableMoney,
      pendingCount: allRequests.length,
      homeRamUsed,
      homeRamTotal,
      homeCores,
      purchasedServerCount,
      purchasedServerLimit,
      largestPurchasedServerName,
      largestPurchasedServerRam,
      hacknetCount,
      hacknetLimit,
      isHacknetServer,
      financeManagerActive,
      sysOrchestratorActive,
      activeEvaluators,
      inactiveEvaluators,
      nextPurchaseRequest: structuredRequests[0] ?? undefined,
      topPendingRequests: structuredRequests.slice(0, 4),
      lastPurchases,
      lastWarnings,
    };

    drawFinanceDashboard(ns, dashboardData);

    await ns.sleep(2000);
  }
}
