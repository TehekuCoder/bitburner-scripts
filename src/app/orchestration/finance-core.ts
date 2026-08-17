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
import { BASE_CATEGORY_MARGINS, CATEGORY_TO_EVALUATOR, CATEGORY_WEIGHTS } from "/shared/constants/finance";


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
    const rawMoney = ns.getServerMoneyAvailable("home");
    let availableMoney = rawMoney;
    const requestsMap = new Map<string, PurchaseRequest>();
    const bnMults = loadBnMults(ns);

    // 1. BitNode-Multiplikatoren auswerten
    const augCostMult = bnMults.AugmentationMoneyCost ?? 1.0;
    const CloudCostMult = bnMults.CloudServerCost ?? 1.0;

    // Dynamische Margen basierend auf BN-Multiplikatoren
    const dynamicMargins: Partial<Record<PurchaseCategory, number>> = {
      ...BASE_CATEGORY_MARGINS,
      // Bei extrem teuren Augmentations 20% Puffer erzwingen
      PLAYER_AUG: augCostMult > 2.0 ? 1.2 : 1.0,
      SLEEVE_AUG: augCostMult > 2.0 ? 1.2 : 1.0,
      PURCHASED_SERVER: CloudCostMult > 3.0 ? 1.15 : 1.0,
    };

    // Bei teuren BitNodes das "Kleingeld" von 1% auf 0.2% senken
    const pocketChangeRatio = augCostMult > 3.0 ? 0.002 : 0.01;

    // 2. Anfragen aus dem Port einsammeln
    const port = ns.getPortHandle(FINANCE_PORT);
    while (!port.empty()) {
      const reqData = port.read() as string;
      if (reqData !== "NULL PORT DATA") {
        try {
          const parsed = JSON.parse(reqData);

          const registerRequests = (
            reqs: PurchaseRequest[],
            cat?: PurchaseCategory,
          ) => {
            const evalName = cat ? CATEGORY_TO_EVALUATOR[cat] : undefined;
            if (evalName) evaluatorLastSeen[evalName] = Date.now();

            for (const req of reqs) {
              if (req?.id) {
                requestsMap.set(req.id, req);
              }
            }
          };

          if (
            parsed &&
            typeof parsed === "object" &&
            Array.isArray(parsed.requests)
          ) {
            registerRequests(parsed.requests, parsed.category);
          } else if (Array.isArray(parsed)) {
            for (const req of parsed as PurchaseRequest[]) {
              registerRequests([req], req.category);
            }
          } else if (parsed && typeof parsed === "object") {
            const req = parsed as PurchaseRequest;
            registerRequests([req], req.category);
          }
        } catch (e) {
          ns.print(`[ERROR] Ungültiges JSON im Finance-Port: ${e}`);
        }
      }
    }

    const allRequests = Array.from(requestsMap.values());

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
    ];
    const activeEvaluators: string[] = [];
    const inactiveEvaluators: string[] = [];
    const now = Date.now();

    for (const name of evaluators) {
      const evaluatorPath =
        PATHS.domain.evaluators.purchase[
          name as keyof typeof PATHS.domain.evaluators.purchase
        ];
      const lastSeen = evaluatorLastSeen[name] ?? 0;
      // 30s Timeout für sequenzielle Durchläufe
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
