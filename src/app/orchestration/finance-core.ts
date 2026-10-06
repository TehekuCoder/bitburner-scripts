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
  CASH_BUFFER,
  CATEGORY_TO_EVALUATOR,
  CATEGORY_WEIGHTS,
  FINANCE_REQUEST_ARG_PREFIX,
  FINANCE_RESULT_PORT,
} from "/shared/constants/finance";
import { loadFinanceState } from "/infrastructure/state/state";

interface EvaluatorCacheEntry {
  timestamp: number;
  requests: Map<string, PurchaseRequest>;
}

const evaluatorRequestCache = new Map<string, EvaluatorCacheEntry>();
interface PendingAction {
  category: PurchaseCategory;
  requestId: string;
  description: string;
  reservedCost: number;
  startedAt: number;
}

const pendingActions = new Map<string, PendingAction>();
const retryAfter = new Map<string, number>();
const CACHE_TTL_MS = 45000; // 45s TTL für Anfragen
const ACTION_TIMEOUT_MS = 60000;
const SINGULARITY_ACTION_RAM: Record<string, number> = {
  "home-upgrade-ram": 3,
  "home-upgrade-cores": 3,
  "program-purchase-tor": 2,
  "program-purchase": 2,
  "player-purchase-aug": 5,
  "player-purchase-aug-batch": 5,
  "player-purchase-nfg": 7.5,
  "player-install-augs": 5,
};
const ACTION_BASE_RAM = 1.6;
const ACTION_RAM_HEADROOM = 0.5;

const PURCHASE_CATEGORIES: readonly PurchaseCategory[] = [
  "HOME_SERVER",
  "PURCHASED_SERVER",
  "DARKNET_PROGRAM",
  "PLAYER_AUG",
  "SLEEVE_AUG",
  "GANG_EQUIPMENT",
  "HACKNET",
  "COMPANY",
  "STOCK_LICENSE",
  "STOCK_TRADE",
];

const CATEGORY_ACTION_SCRIPTS: Record<PurchaseCategory, string> = {
  HOME_SERVER: PATHS.app.actions.singularity,
  PURCHASED_SERVER: PATHS.app.actions.cloud,
  DARKNET_PROGRAM: PATHS.app.actions.singularity,
  PLAYER_AUG: PATHS.app.actions.singularity,
  SLEEVE_AUG: PATHS.app.actions.sleeve,
  GANG_EQUIPMENT: PATHS.app.actions.gang,
  HACKNET: PATHS.app.actions.hacknet,
  COMPANY: PATHS.app.actions.corporation,
  STOCK_LICENSE: PATHS.app.actions.stock,
  STOCK_TRADE: PATHS.app.actions.stock,
};

function isPurchaseCategory(value: unknown): value is PurchaseCategory {
  return (
    typeof value === "string" &&
    PURCHASE_CATEGORIES.includes(value as PurchaseCategory)
  );
}

function parsePurchaseRequest(
  value: unknown,
  batchCategory?: PurchaseCategory,
): PurchaseRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const request = value as Partial<PurchaseRequest>;
  const category = request.category ?? batchCategory;
  if (
    !request.id ||
    typeof request.id !== "string" ||
    request.id.length > 200 ||
    !isPurchaseCategory(category) ||
    (batchCategory !== undefined && category !== batchCategory) ||
    !Number.isFinite(request.cost) ||
    (request.cost ?? -1) < 0 ||
    typeof request.priority !== "number" ||
    !Object.values(PurchasePriority).some(
      (priority) => typeof priority === "number" && priority === request.priority,
    ) ||
    typeof request.description !== "string" ||
    typeof request.action?.script !== "string" ||
    request.action.script !== CATEGORY_ACTION_SCRIPTS[category] ||
    !Array.isArray(request.action.args) ||
    !request.action.args.every(
      (arg) =>
        typeof arg === "string" ||
        (typeof arg === "number" && Number.isFinite(arg)),
    ) ||
    (request.score !== undefined && !Number.isFinite(request.score))
  ) {
    return null;
  }
  return { ...request, category } as PurchaseRequest;
}

function trackingId(category: PurchaseCategory, requestId: string): string {
  return `${category}:${requestId}`;
}

function pushBounded<T>(array: T[], item: T, maxSize: number = 6): void {
  array.push(item);
  while (array.length > maxSize) {
    array.shift();
  }
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new LoggerClient(ns, "FINANCE");
  ns.ui.openTail();

  ns.ui.setTailTitle("Finance-Core");
  ns.ui.resizeTail(618, 535);

  const lastPurchases: string[] = [];
  const lastWarnings: string[] = [];
  const evaluatorLastSeen: Record<string, number> = {};
  let singularityRamMultiplier: number | null = null;

  while (true) {
    const now = Date.now();
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

          if (
            parsed &&
            typeof parsed === "object" &&
            Array.isArray(parsed.requests)
          ) {
            if (!isPurchaseCategory(parsed.category)) {
              ns.print("[ERROR] Ungültige Kategorie im Finance-Batch.");
              continue;
            }
            const requests = parsed.requests.map((request: unknown) =>
              parsePurchaseRequest(request, parsed.category),
            );
            if (requests.some((request: PurchaseRequest | null) => !request)) {
              ns.print(
                `[ERROR] Ungültiger Request im Finance-Batch (${parsed.category}); Batch verworfen.`,
              );
              continue;
            }
            const category = parsed.category as PurchaseCategory;
            const requestMap = new Map<string, PurchaseRequest>();
            for (const request of requests as PurchaseRequest[]) {
              requestMap.set(request.id, request);
            }
            evaluatorRequestCache.set(category, { timestamp: now, requests: requestMap });
            const evalName = CATEGORY_TO_EVALUATOR[category];
            if (evalName) evaluatorLastSeen[evalName] = now;
          } else if (Array.isArray(parsed)) {
            const requests = parsed.map((request: unknown) =>
              parsePurchaseRequest(request),
            );
            if (requests.some((request: PurchaseRequest | null) => !request)) {
              ns.print("[ERROR] Ungültiger Legacy-Request im Finance-Port.");
              continue;
            }
            const byCategory = new Map<PurchaseCategory, PurchaseRequest[]>();
            for (const request of requests as PurchaseRequest[]) {
              const categoryRequests = byCategory.get(request.category) ?? [];
              categoryRequests.push(request);
              byCategory.set(request.category, categoryRequests);
            }
            for (const [category, categoryRequests] of byCategory) {
              evaluatorRequestCache.set(category, {
                timestamp: now,
                requests: new Map(categoryRequests.map((request) => [request.id, request])),
              });
              const evalName = CATEGORY_TO_EVALUATOR[category];
              if (evalName) evaluatorLastSeen[evalName] = now;
            }
          } else if (parsed && typeof parsed === "object") {
            const request = parsePurchaseRequest(parsed);
            if (!request) {
              ns.print("[ERROR] Ungültiger Request im Finance-Port.");
              continue;
            }
            const existing = evaluatorRequestCache.get(request.category);
            const requests = existing?.requests ?? new Map<string, PurchaseRequest>();
            requests.set(request.id, request);
            evaluatorRequestCache.set(request.category, { timestamp: now, requests });
            const evalName = CATEGORY_TO_EVALUATOR[request.category];
            if (evalName) evaluatorLastSeen[evalName] = now;
          }
        } catch (e) {
          ns.print(`[ERROR] Ungültiges JSON im Finance-Port: ${e}`);
        }
      }
    }

    const resultPort = ns.getPortHandle(FINANCE_RESULT_PORT);
    while (!resultPort.empty()) {
      const resultData = resultPort.read();
      if (typeof resultData !== "string" || resultData === "NULL PORT DATA") {
        continue;
      }
      try {
        const result = JSON.parse(resultData) as {
          requestId?: unknown;
          success?: unknown;
          actualCost?: unknown;
        };
        if (
          typeof result.requestId !== "string" ||
          typeof result.success !== "boolean" ||
          typeof result.actualCost !== "number" ||
          !Number.isFinite(result.actualCost) ||
          result.actualCost < 0
        ) {
          ns.print("[ERROR] Ungültiges Action-Ergebnis auf dem Finance-Result-Port.");
          continue;
        }

        const pending = pendingActions.get(result.requestId);
        if (!pending) continue;
        pendingActions.delete(result.requestId);
        if (result.success) {
          const purchaseMsg = `🛒 [$${ns.format.number(result.actualCost)}] ${pending.description}`;
          logger.success(purchaseMsg);
          pushBounded(lastPurchases, purchaseMsg, 6);
          evaluatorRequestCache
            .get(pending.category)
            ?.requests.delete(pending.requestId);
          retryAfter.delete(result.requestId);
        } else {
          const errorMsg = `⚠️ Kauf fehlgeschlagen: ${pending.description}`;
          logger.warn(errorMsg);
          pushBounded(lastWarnings, errorMsg, 6);
          retryAfter.set(result.requestId, now + 5000);
        }
      } catch (e) {
        ns.print(`[ERROR] Ungültiges JSON auf dem Finance-Result-Port: ${e}`);
      }
    }

    for (const [id, pending] of pendingActions) {
      if (now - pending.startedAt > ACTION_TIMEOUT_MS) {
        pendingActions.delete(id);
        retryAfter.set(id, now + 5000);
        const warning = `⚠️ Keine Rückmeldung von Kauf-Action erhalten: ${pending.description}`;
        logger.warn(warning);
        pushBounded(lastWarnings, warning, 6);
      }
    }

    const rawMoney = ns.getServerMoneyAvailable("home");
    const stateReserve = loadFinanceState(ns)?.moneyReserve ?? 0;
    const reserve = Math.max(
      CASH_BUFFER,
      Number.isFinite(stateReserve) && stateReserve > 0 ? stateReserve : 0,
    );
    let availableMoney = Math.max(0, rawMoney - reserve);
    for (const pending of pendingActions.values()) {
      availableMoney = Math.max(0, availableMoney - pending.reservedCost);
    }

    // Veraltete Kategorien entfernen
    for (const [cat, cache] of evaluatorRequestCache.entries()) {
      if (now - cache.timestamp > CACHE_TTL_MS) {
        evaluatorRequestCache.delete(cat);
      }
    }

    // Aktive Anfragen aggregieren
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

    const evaluators = Object.keys(PATHS.domain.evaluators.purchase);
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
        const requestTrackingId = trackingId(req.category, req.id);
        if (
          pendingActions.has(requestTrackingId) ||
          (retryAfter.get(requestTrackingId) ?? 0) > now
        ) {
          continue;
        }
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
          const ramOverride =
            req.action.script === PATHS.app.actions.singularity
              ? getSingularityActionRam(
                  req.action.args,
                  singularityRamMultiplier ??
                    (singularityRamMultiplier = getSingularityRamMultiplier(ns)),
                )
              : undefined;
          const pid = ns.exec(
            req.action.script,
            "home",
            ramOverride === undefined
              ? 1
              : { threads: 1, ramOverride },
            ...req.action.args,
            `${FINANCE_REQUEST_ARG_PREFIX}${requestTrackingId}`,
          );

          if (pid > 0) {
            pendingActions.set(requestTrackingId, {
              category: req.category,
              requestId: req.id,
              description: req.description,
              reservedCost: requiredBudget,
              startedAt: now,
            });
            availableMoney = Math.max(0, availableMoney - requiredBudget);
            await ns.sleep(20);
          } else {
            const errorMsg = `⚠️ Script-Start fehlgeschlagen: ${req.action.script}`;
            logger.warn(errorMsg);
            pushBounded(lastWarnings, errorMsg, 6);
          }
        } else {
          // Beträge nach vorne gesetzt, damit sie beim Truncate nicht abgeschnitten werden!
          const savingMsg = `⏳ [$${ns.format.number(availableMoney)} / $${ns.format.number(req.cost)}] ${req.description}`;
          pushBounded(lastWarnings, savingMsg, 6);

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

function getSingularityRamMultiplier(ns: NS): number {
  const resetInfo = ns.getResetInfo();
  if (resetInfo.currentNode === 4) return 1;

  const sourceFileLevel = resetInfo.ownedSF.get(4) ?? 0;
  if (sourceFileLevel >= 3) return 1;
  if (sourceFileLevel >= 2) return 4;
  return 16;
}

function getSingularityActionRam(
  args: readonly (string | number)[],
  multiplier: number,
): number | undefined {
  const action = String(args[0] ?? "");
  const hasExpectedBatchCost =
    action === "player-purchase-aug-batch" &&
    typeof args[2] === "number" &&
    Number.isFinite(args[2]) &&
    args[2] >= 0;
  const singularityApiRam =
    action === "player-purchase-aug-batch" && !hasExpectedBatchCost
      ? 7.5
      : SINGULARITY_ACTION_RAM[action];
  if (singularityApiRam === undefined) return undefined;

  const actionRam =
    ACTION_BASE_RAM +
    singularityApiRam * multiplier +
    0.1 +
    ACTION_RAM_HEADROOM;
  return Math.ceil(actionRam * 100) / 100;
}
