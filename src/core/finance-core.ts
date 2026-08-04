// core/finance-core.ts

import { NS } from "@ns";
import {
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
  CATEGORY_WEIGHTS,
} from "/lib/types/finance.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { drawFinanceDashboard, FinanceDashboardData } from "/ui/finance-ui.js";
import { PATHS } from "/lib/paths.js";

const FINANCE_PORT = 10;

const CATEGORY_MARGINS: Partial<Record<PurchaseCategory, number>> = {
  STOCK_LICENSE: 1.0,
  STOCK_TRADE: 1.5,
};

const CATEGORY_TO_EVALUATOR: Partial<Record<PurchaseCategory, string>> = {
  HOME_SERVER: "home",
  PURCHASED_SERVER: "pserv",
  DARKNET_PROGRAM: "programs",
  GANG_EQUIPMENT: "gang",
  SLEEVE_AUG: "sleeve",
  PLAYER_AUG: "player",
  HACKNET: "hacknet",
  STOCK_LICENSE: "stock",
  STOCK_TRADE: "stock",
};

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "FINANCE");
  ns.ui.openTail();

  ns.ui.setTailTitle("Finance-Core");

  ns.ui.resizeTail(618, 515);

  const lastPurchases: string[] = [];
  const lastWarnings: string[] = [];

  // Tracking wann welcher Evaluator zuletzt eine Anfrage geschickt hat (Timestamp in ms)
  const evaluatorLastSeen: Record<string, number> = {};

  while (true) {
    const rawMoney = ns.getServerMoneyAvailable("home");
    let availableMoney = rawMoney;
    const allRequests: PurchaseRequest[] = [];

    // 1. Anfragen aus dem Port einsammeln
    const port = ns.getPortHandle(FINANCE_PORT);
    while (!port.empty()) {
      const reqData = port.read() as string;
      if (reqData !== "NULL PORT DATA") {
        try {
          const parsed = JSON.parse(reqData);

          // Bündel-Format aus evaluator-runner: { category: "...", requests: [...] }
          if (
            parsed &&
            typeof parsed === "object" &&
            Array.isArray(parsed.requests)
          ) {
            const cat = parsed.category as PurchaseCategory;
            const evalName = cat ? CATEGORY_TO_EVALUATOR[cat] : undefined;
            if (evalName) evaluatorLastSeen[evalName] = Date.now();

            for (const req of parsed.requests as PurchaseRequest[]) {
              allRequests.push(req);
            }
          }
          // Abwärtskompatibilität: Array von Anfragen
          else if (Array.isArray(parsed)) {
            for (const req of parsed as PurchaseRequest[]) {
              allRequests.push(req);
              const evalName = req.category
                ? CATEGORY_TO_EVALUATOR[req.category]
                : undefined;
              if (evalName) evaluatorLastSeen[evalName] = Date.now();
            }
          }
          // Abwärtskompatibilität: Einzelne Anfrage
          else if (parsed && typeof parsed === "object") {
            const req = parsed as PurchaseRequest;
            allRequests.push(req);
            const evalName = req.category
              ? CATEGORY_TO_EVALUATOR[req.category]
              : undefined;
            if (evalName) evaluatorLastSeen[evalName] = Date.now();
          }
        } catch (e) {
          ns.print(`[ERROR] Ungültiges JSON im Finance-Port: ${e}`);
        }
      }
    }

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

    const financeManagerActive = ns.isRunning(
      PATHS.daemons.financeManager,
      "home",
    );
    const suiteManagerActive = ns.isRunning("core/sys-suites.js", "home");

    // Evaluatoren-Status: Aktiv wenn innerhalb der letzten 10 Sekunden Anfragen gesendet wurden
    const evaluators = [
      "home",
      "hacknet",
      "stock",
      "pserv",
      "programs",
      "gang",
      "sleeve",
      "player",
    ];
    const activeEvaluators: string[] = [];
    const inactiveEvaluators: string[] = [];
    const now = Date.now();

    for (const name of evaluators) {
      const lastSeen = evaluatorLastSeen[name] ?? 0;
      // Wenn in den letzten 10s Daten kamen ODER das Script gerade exakt läuft:
      if (
        now - lastSeen < 10000 ||
        ns.isRunning(`lib/evaluators/${name}.js`, "home")
      ) {
        activeEvaluators.push(name);
      } else {
        inactiveEvaluators.push(name);
      }
    }

    // 2. Sortierung der Anfragen
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

      // 3. Käufe verarbeiten mit intelligentem Blocking
      const blockedCategories = new Set<PurchaseCategory>();
      let highestUnsatisfiedPriority = PurchasePriority.IDLE;

      const POCKET_CHANGE_RATIO = 0.01; // 1% des aktuellen Vermögens gilt als "Kleingeld"

      for (const req of allRequests) {
        const margin = CATEGORY_MARGINS[req.category] ?? 1.0;
        const requiredBudget = req.cost * margin;

        const canAffordEasily = availableMoney >= requiredBudget;
        // 💡 Neu: Ist es spottbillig im Vergleich zu unserem Vermögen?
        const isPocketChange = req.cost <= rawMoney * POCKET_CHANGE_RATIO;

        // 1. Wenn die Kategorie bereits gesperrt ist und es teuer ist -> Überspringen
        if (blockedCategories.has(req.category) && !canAffordEasily) {
          continue;
        }

        // 2. SPARRULE: Wenn wir auf ein Ziel sparen...
        // Blockieren wir nachfolgende Items NUR DANN, wenn es KEIN Kleingeld ist!
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
          // Geld reicht nicht -> Sparziel setzen und Kategorie blockieren
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
      financeManagerActive,
      suiteManagerActive,
      activeEvaluators,
      inactiveEvaluators,
      nextPurchaseRequest: structuredRequests[0] ?? undefined,
      topPendingRequests: structuredRequests.slice(0, 4),
      lastPurchases,
      lastWarnings,
    };

    drawFinanceDashboard(ns, dashboardData);

    ns.clearPort(FINANCE_PORT);
    await ns.sleep(2000);
  }
}
