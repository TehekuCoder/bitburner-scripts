// core/finance-core.ts

import { NS } from "@ns";
import {
  PurchaseRequest,
  PurchasePriority,
  PurchaseCategory,
} from "/lib/types/finance.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { drawFinanceDashboard, FinanceDashboardData } from "/ui/finance-ui.js";

const FINANCE_PORT = 10; // Port für unsere Microservices

const CATEGORY_MARGINS: Partial<Record<PurchaseCategory, number>> = {
  STOCK_LICENSE: 1.0,
  STOCK_TRADE: 1.5,
};

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "FINANCE");
  ns.ui.openTail();
  ns.ui.setTailTitle("Finance-Core");
  ns.print("⚡ Finance-Core aktiv (Banker-Modus / ~2GB RAM).");

  const lastPurchases: string[] = [];
  const lastWarnings: string[] = [];

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
          allRequests.push(JSON.parse(reqData));
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

    const financeManagerActive = ns.isRunning("managers/finance-manager.js", "home");
    const suiteManagerActive = ns.isRunning("core/sys-suites.js", "home");

    const evaluators = [
      { name: "home", path: "lib/evaluators/home.js" },
      { name: "hacknet", path: "lib/evaluators/hacknet.js" },
      { name: "stock", path: "lib/evaluators/stock.js" },
      { name: "pserv", path: "lib/evaluators/pserv.js" },
      { name: "programs", path: "lib/evaluators/programs.js" },
      { name: "gang", path: "lib/evaluators/gang.js" },
      { name: "sleeve", path: "lib/evaluators/sleeve.js" },
      { name: "player", path: "lib/evaluators/player.js" },
    ];

    const activeEvaluators: string[] = [];
    const inactiveEvaluators: string[] = [];

    for (const evaluator of evaluators) {
      if (ns.fileExists(evaluator.path, "home")) {
        if (ns.isRunning(evaluator.path, "home")) {
          activeEvaluators.push(evaluator.name);
        } else {
          inactiveEvaluators.push(evaluator.name);
        }
      }
    }

    if (allRequests.length > 0) {
      // 2. Sortierung: Prio -> Score (ROI) -> Kosten
      allRequests.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        const scoreA = a.score ?? 0;
        const scoreB = b.score ?? 0;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return a.cost - b.cost;
      });

      // 3. Käufe abarbeiten
      for (const req of allRequests) {
        const margin = CATEGORY_MARGINS[req.category] ?? 1.0;
        const requiredBudget = req.cost * margin;

        if (availableMoney >= requiredBudget) {
          const pid = ns.exec(req.action.script, "home", 1, ...req.action.args);

          if (pid > 0) {
            const purchaseMsg = `🛒 KAUF BEAUFTRAGT: ${req.description} für $${ns.format.number(req.cost)}`;
            logger.success(purchaseMsg, undefined, { context: { requestId: req.id, category: req.category } });
            lastPurchases.push(purchaseMsg);
            if (lastPurchases.length > 6) lastPurchases.shift();

            availableMoney -= req.cost;
            await ns.sleep(50);
          } else {
            const errorMsg = `⚠️ Ausführung fehlgeschlagen (RAM voll?): ${req.id}`;
            logger.warn(errorMsg, undefined, { context: { requestId: req.id } });
            lastWarnings.push(errorMsg);
            if (lastWarnings.length > 6) lastWarnings.shift();
          }
        } else {
          const isPeanuts = req.cost < rawMoney * 0.01;
          if (req.priority === PurchasePriority.CRITICAL || !isPeanuts) {
            const savingMsg = `⏳ SPARZIEL: ${req.description} ($${ns.format.number(availableMoney)} / $${ns.format.number(req.cost)})`;
            logger.info(savingMsg, undefined, { context: { requestId: req.id, category: req.category } });
            lastWarnings.push(savingMsg);
            if (lastWarnings.length > 6) lastWarnings.shift();
            break;
          }
        }
      }
    }

    const topPendingRequestLines = allRequests.slice(0, 3).map((req) => {
      const priorityLabel = PurchasePriority[req.priority] ?? req.priority;
      const scoreLabel = req.score !== undefined ? ` | Score: ${req.score.toFixed(2)}` : "";
      return `${req.description} (${req.category}, Prio ${priorityLabel}) - $${ns.format.number(req.cost)}${scoreLabel}`;
    });

    const nextPurchase = allRequests[0]
      ? `${allRequests[0].description} (${allRequests[0].category}) — $${ns.format.number(allRequests[0].cost)}`
      : "Keine offenen Anfragen";

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
      nextPurchase,
      topPendingRequestLines,
      lastPurchases,
      lastWarnings,
    };

    drawFinanceDashboard(ns, dashboardData);

    ns.clearPort(FINANCE_PORT);
    await ns.sleep(2000);
  }
}