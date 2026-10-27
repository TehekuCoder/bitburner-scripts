import { NS } from "@ns";
import {
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/shared/types/finance.js";
import { drawFinanceDashboard, FinanceDashboardData } from "/ui/finance-ui.js";

import { hasSingularity, loadBnMults } from "/lib/utils.js";
import { LoggerClient } from "/infrastructure/logging/logger-client";
import { FINANCE_PORT } from "../../domain/evaluators/evaluator-runner";
import { PATHS } from "/infrastructure/runtime/paths";
import {
  BASE_CATEGORY_MARGINS,
  AUG_PURCHASE_PLAN_FILE,
  CASH_BUFFER,
  CATEGORY_TO_EVALUATOR,
  CATEGORY_WEIGHTS,
  FINANCE_REQUEST_ARG_PREFIX,
  FINANCE_RESULT_PORT,
} from "/shared/constants/finance";
import {
  loadAugmentState,
  loadFinanceState,
} from "/infrastructure/state/state";
import { getPurchasedUninstalledAugs } from "/domain/strategy/player.js";
import {
  getSingularityActionRam,
  getSingularityRamMultiplier,
} from "/app/actions/singularity-action-ram.js";
import {
  canAffordFinanceRequest,
  compareFinanceRequests,
  findCachedFinanceRequest,
  findRunningFinanceAction,
  getCompletedAugmentationPurchaseOutcome,
  hasPendingFinanceCategory,
  isAugmentationPurchasePriceStale,
  isFinanceRequestRecentlyCompleted,
  isFinanceActionTimedOut,
  pruneExpiredFinanceRetries,
} from "./finance-runtime.js";

interface EvaluatorCacheEntry {
  timestamp: number;
  requests: Map<string, PurchaseRequest>;
}

const evaluatorRequestCache = new Map<string, EvaluatorCacheEntry>();
interface PendingAction {
  category: PurchaseCategory;
  requestId: string;
  description: string;
  augmentation?: string;
  pid: number;
  requestCost: number;
  reservedCost: number;
  startedAt: number;
}

const pendingActions = new Map<string, PendingAction>();
const retryAfter = new Map<string, number>();
const completedRequests = new Map<string, number>();
const CACHE_TTL_MS = 45000; // 45s TTL für Anfragen
const ACTION_TIMEOUT_MS = 60000;
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

function getAugmentationName(request: PurchaseRequest): string | undefined {
  return request.category === "PLAYER_AUG" &&
    request.action.args[0] === "player-purchase-aug" &&
    typeof request.action.args[2] === "string"
    ? request.action.args[2]
    : undefined;
}

function removeCompletedRequest(
  category: PurchaseCategory | undefined,
  requestId: string | undefined,
): void {
  if (!category || requestId === undefined) return;

  const requests = evaluatorRequestCache.get(category)?.requests;
  if (!requests) return;

  if (category === "PLAYER_AUG") {
    requests.clear();
  } else {
    requests.delete(requestId);
  }
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
  let criticalAugPurchaseNotified = false;

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
        const cachedRequest = pending
          ? undefined
          : findCachedFinanceRequest(
              evaluatorRequestCache.values(),
              result.requestId,
            );
        if (!pending && !cachedRequest) {
          if (result.success) {
            completedRequests.set(
              result.requestId,
              now + CACHE_TTL_MS,
            );
          } else {
            retryAfter.set(result.requestId, now + 5000);
          }
          continue;
        }
        pendingActions.delete(result.requestId);
        const category = pending?.category ?? cachedRequest?.category;
        const requestId = pending?.requestId ?? cachedRequest?.id;
        const description = pending?.description ?? cachedRequest?.description;
        if (result.success) {
          if (description !== undefined) {
            const purchaseMsg = `🛒 [$${ns.format.number(result.actualCost)}] ${description}`;
            logger.success(purchaseMsg);
            pushBounded(lastPurchases, purchaseMsg, 6);
            if (requestId?.startsWith("player-aug-")) {
              ns.toast(
                `Augmentation erfolgreich gekauft: ${description}`,
                "success",
                5000,
              );
            }
          }
          removeCompletedRequest(category, requestId);
          retryAfter.delete(result.requestId);
          completedRequests.set(result.requestId, now + CACHE_TTL_MS);
        } else {
          const augmentationRequestCost =
            pending?.requestCost ?? cachedRequest?.cost;
          const augmentationMaximumPrice = cachedRequest
            ? Number(cachedRequest.action.args[3])
            : augmentationRequestCost;
          const augmentationName =
            pending?.augmentation ??
            (cachedRequest ? getAugmentationName(cachedRequest) : undefined);
          if (
            category === "PLAYER_AUG" &&
            augmentationName &&
            augmentationRequestCost !== undefined &&
            hasSingularity(ns) &&
            isAugmentationPurchasePriceStale(
              augmentationRequestCost,
              augmentationMaximumPrice ?? Number.NaN,
              ns.singularity.getAugmentationPrice(augmentationName),
            )
          ) {
            removeCompletedRequest(category, requestId);
            retryAfter.delete(result.requestId);
            continue;
          }
          removeCompletedRequest(category, requestId);
          if (description !== undefined) {
            const errorMsg = `⚠️ Kauf fehlgeschlagen: ${description}`;
            logger.warn(errorMsg);
            pushBounded(lastWarnings, errorMsg, 6);
            if (requestId?.startsWith("player-aug-")) {
              ns.toast(
                `Augmentationskauf fehlgeschlagen: ${description}`,
                "error",
                7000,
              );
            }
          }
          retryAfter.set(result.requestId, now + 5000);
        }
      } catch (e) {
        ns.print(`[ERROR] Ungültiges JSON auf dem Finance-Result-Port: ${e}`);
      }
    }

    for (const [id, pending] of pendingActions) {
      if (pending.category !== "PLAYER_AUG" || !pending.augmentation) continue;

      const isRunning = ns.isRunning(pending.pid, "home");
      const purchaseOutcome = getCompletedAugmentationPurchaseOutcome(
        isRunning,
        !isRunning && hasSingularity(ns)
          ? ns.singularity.getOwnedAugmentations(true)
          : [],
        pending.augmentation,
      );
      if (purchaseOutcome === undefined) continue;

      pendingActions.delete(id);
      if (purchaseOutcome) {
        const purchaseMsg = `🛒 [$${ns.format.number(pending.requestCost)}] ${pending.description}`;
        logger.success(purchaseMsg);
        pushBounded(lastPurchases, purchaseMsg, 6);
        ns.toast(
          `Augmentation erfolgreich gekauft: ${pending.description}`,
          "success",
          5000,
        );
        removeCompletedRequest(pending.category, pending.requestId);
        retryAfter.delete(id);
        completedRequests.set(id, now + CACHE_TTL_MS);
      } else {
        const errorMsg = `⚠️ Kauf fehlgeschlagen: ${pending.description}`;
        logger.warn(errorMsg);
        pushBounded(lastWarnings, errorMsg, 6);
        ns.toast(
          `Augmentationskauf fehlgeschlagen: ${pending.description}`,
          "error",
          7000,
        );
        removeCompletedRequest(pending.category, pending.requestId);
        retryAfter.set(id, now + 5000);
      }
    }

    for (const [id, pending] of pendingActions) {
      if (
        isFinanceActionTimedOut(now, pending.startedAt, ACTION_TIMEOUT_MS)
      ) {
        const runningScript = ns.getRunningScript(pending.pid, "home");
        const isPendingActionRunning =
          runningScript?.filename === CATEGORY_ACTION_SCRIPTS[pending.category] &&
          runningScript.args[runningScript.args.length - 1] ===
            `${FINANCE_REQUEST_ARG_PREFIX}${id}`;
        const stopped = isPendingActionRunning && ns.kill(pending.pid);
        if (isPendingActionRunning && !stopped) {
          const warning = `⚠️ Kauf-Action konnte nach Timeout nicht beendet werden; Budget bleibt reserviert: ${pending.description}`;
          logger.warn(warning);
          pushBounded(lastWarnings, warning, 6);
          continue;
        }
        pendingActions.delete(id);
        retryAfter.set(id, now + 5000);
        const warning = isPendingActionRunning
          ? `⚠️ Kauf-Action nach Timeout beendet; Budget-Reservierung freigegeben: ${pending.description}`
          : `⚠️ Keine Rückmeldung von beendeter Kauf-Action erhalten: ${pending.description}`;
        logger.warn(warning);
        pushBounded(lastWarnings, warning, 6);
        if (pending.requestId.startsWith("player-aug-")) {
          ns.toast(
            `Keine Rückmeldung zum Augmentationskauf: ${pending.description}`,
            "warning",
            7000,
          );
        }
      }
    }
    pruneExpiredFinanceRetries(retryAfter, now);
    pruneExpiredFinanceRetries(completedRequests, now);

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
    const uninstalledAugs = getPurchasedUninstalledAugs(ns);
    const isAugmentationMode = uninstalledAugs.length > 0;

    const augPurchasePlan = loadAugmentState(ns)?.augPurchasePlan;
    if (augPurchasePlan && Array.isArray(augPurchasePlan.items)) {
      const plan = [
        "Fester Augmentierungs-Kaufplan",
        `Erstellt: ${new Date(augPurchasePlan.createdAt).toISOString()}`,
        ...augPurchasePlan.items.map(
          (item, index) =>
            `${index + 1}. ${item.name} — Rep ${ns.format.number(item.repReq)} — $${ns.format.number(item.basePrice)} — ${item.factions.join(", ")}`,
        ),
        "",
      ].join("\n");
      if (ns.read(AUG_PURCHASE_PLAN_FILE) !== plan) {
        await ns.write(AUG_PURCHASE_PLAN_FILE, plan, "w");
      }
    }
    if (isAugmentationMode) {
      const maintenanceRequests = allRequests.filter(
        (request) =>
          request.category === "SLEEVE_AUG" ||
          request.category === "GANG_EQUIPMENT",
      );
      allRequests.splice(
        0,
        allRequests.length,
        ...maintenanceRequests,
      );
    }

    const criticalAugPurchase = allRequests.find(
      (request) =>
        request.category === "PLAYER_AUG" &&
        request.priority === PurchasePriority.CRITICAL &&
        request.action.args[0] === "player-purchase-aug",
    );
    if (criticalAugPurchase && !criticalAugPurchaseNotified) {
      ns.toast(
        `Kritische Augmentation erkannt: ${criticalAugPurchase.description}. Sie wird priorisiert; falls sie noch nicht bezahlbar ist, können günstigere Augs gekauft werden.`,
        "warning",
        7000,
      );
      criticalAugPurchaseNotified = true;
    } else if (!criticalAugPurchase) {
      criticalAugPurchaseNotified = false;
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
      allRequests.sort((a, b) =>
        compareFinanceRequests(a, b, CATEGORY_WEIGHTS),
      );

      // 4. Käufe verarbeiten
      const blockedCategories = new Set<PurchaseCategory>();
      let highestUnsatisfiedPriority = Number.MAX_SAFE_INTEGER;
      const runningProcesses = ns.ps("home");
      const canAffordCriticalAug =
        criticalAugPurchase !== undefined &&
        canAffordFinanceRequest(
          availableMoney,
          criticalAugPurchase.cost,
          dynamicMargins.PLAYER_AUG ?? 1.0,
        );

      for (const req of allRequests) {
        const requestTrackingId = trackingId(req.category, req.id);
        const isPlayerAugAlreadyPending =
          req.category === "PLAYER_AUG" &&
          hasPendingFinanceCategory(pendingActions.values(), "PLAYER_AUG");
        if (
          pendingActions.has(requestTrackingId) ||
          isPlayerAugAlreadyPending ||
          (retryAfter.get(requestTrackingId) ?? 0) > now ||
          isFinanceRequestRecentlyCompleted(
            completedRequests,
            requestTrackingId,
            now,
          )
        ) {
          continue;
        }
        const runningAction = findRunningFinanceAction(
          runningProcesses,
          req.action.script,
          requestTrackingId,
          FINANCE_REQUEST_ARG_PREFIX,
        );
        if (runningAction) {
          const margin = dynamicMargins[req.category] ?? 1.0;
          const reservedCost = req.cost * margin;
          pendingActions.set(requestTrackingId, {
            category: req.category,
            requestId: req.id,
            description: req.description,
            augmentation: getAugmentationName(req),
            pid: runningAction.pid,
            requestCost: req.cost,
            reservedCost,
            startedAt: now,
          });
          availableMoney = Math.max(0, availableMoney - reservedCost);
          continue;
        }
        if (
          req.category === "PLAYER_AUG" &&
          req.action.args[0] === "player-purchase-aug"
        ) {
          const augmentation = getAugmentationName(req);
          const maximumPrice = Number(req.action.args[3]);
          if (
            augmentation &&
            hasSingularity(ns) &&
            isAugmentationPurchasePriceStale(
              req.cost,
              maximumPrice,
              ns.singularity.getAugmentationPrice(augmentation),
            )
          ) {
            evaluatorRequestCache.get("PLAYER_AUG")?.requests.clear();
            break;
          }
        }
        if (
          canAffordCriticalAug &&
          criticalAugPurchase &&
          req !== criticalAugPurchase
        ) {
          continue;
        }
        const margin = dynamicMargins[req.category] ?? 1.0;
        const requiredBudget = req.cost * margin;

        const canAffordEasily = canAffordFinanceRequest(
          availableMoney,
          req.cost,
          margin,
        );
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
              augmentation: getAugmentationName(req),
              pid,
              requestCost: req.cost,
              reservedCost: requiredBudget,
              startedAt: now,
            });
            availableMoney = Math.max(0, availableMoney - requiredBudget);
            await ns.sleep(20);
          } else {
            const errorMsg = `⚠️ Script-Start fehlgeschlagen: ${req.action.script}`;
            logger.warn(errorMsg);
            pushBounded(lastWarnings, errorMsg, 6);
            if (req.action.args[0] === "player-purchase-aug") {
              ns.toast(
                `Augmentationskauf konnte nicht gestartet werden.`,
                "error",
                7000,
              );
            }
          }
        } else {
          // Beträge nach vorne gesetzt, damit sie beim Truncate nicht abgeschnitten werden!
          const savingMsg = `⏳ [$${ns.format.number(availableMoney)} / $${ns.format.number(req.cost)}] ${req.description}`;
          pushBounded(lastWarnings, savingMsg, 6);

          blockedCategories.add(req.category);

          if (
            req.priority < highestUnsatisfiedPriority &&
            !(req === criticalAugPurchase && !canAffordCriticalAug)
          ) {
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
    let proposedAugPurchaseData: FinanceDashboardData["proposedAugPurchase"];
    const nextPlannedAug = !isAugmentationMode && hasSingularity(ns)
      ? augPurchasePlan?.items.find(
          (item) => !ns.singularity.getOwnedAugmentations(true).includes(item.name),
        )
      : undefined;
    if (nextPlannedAug && hasSingularity(ns)) {
      const memberFactions = new Set(ns.getPlayer().factions);
      if (ns.gang?.inGang()) {
        memberFactions.add(ns.gang.getGangInformation().faction);
      }
      const factionProgress = nextPlannedAug.factions
        .filter((faction) => memberFactions.has(faction))
        .map((faction) => {
          const rep = ns.singularity.getFactionRep(faction);
          const favor = ns.singularity.getFactionFavor(faction);
          const repGap = Math.max(0, nextPlannedAug.repReq - rep);
          return {
            name: faction,
            rep,
            favor,
            estimatedRemainingRep: repGap / (1 + Math.max(0, favor) / 100),
            available: rep >= nextPlannedAug.repReq,
          };
        })
        .sort(
          (a, b) =>
            a.estimatedRemainingRep - b.estimatedRemainingRep ||
            b.favor - a.favor ||
            a.name.localeCompare(b.name),
        );
      const augRequest = allRequests.find(
        (request) =>
          request.category === "PLAYER_AUG" &&
          request.action.args[0] === "player-purchase-aug" &&
          request.action.args[2] === nextPlannedAug.name,
      );
      const purchaseCost = augRequest?.cost ??
        ns.singularity.getAugmentationPrice(nextPlannedAug.name);
      const availableForPurchase =
        rawMoney -
        reserve -
        Array.from(pendingActions.values()).reduce(
          (total, pending) => total + pending.reservedCost,
          0,
        );
      proposedAugPurchaseData = {
        name: nextPlannedAug.name,
        cost: purchaseCost,
        faction:
          typeof augRequest?.action.args[1] === "string"
            ? augRequest.action.args[1]
            : undefined,
        running: augRequest
          ? pendingActions.has(trackingId(augRequest.category, augRequest.id))
          : false,
        waitingForFunds:
          !!augRequest &&
          availableForPurchase <
            augRequest.cost * (dynamicMargins.PLAYER_AUG ?? 1.0),
        waitingForFactionRep:
          !augRequest && !factionProgress.some((faction) => faction.available),
        factions: factionProgress,
      };
    }
    const proposedAugInstallData = uninstalledAugs.length > 0
      ? { items: uninstalledAugs }
      : undefined;

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
      proposedAugPurchase: proposedAugPurchaseData,
      proposedAugInstall: proposedAugInstallData,
      topPendingRequests: structuredRequests.slice(0, 4),
      lastPurchases,
      lastWarnings,
    };

    drawFinanceDashboard(ns, dashboardData);

    await ns.sleep(2000);
  }
}
