import { NS } from "@ns";

export interface PendingRequestSummary {
  description: string;
  category: string;
  priorityLabel: string;
  cost: number;
  score?: number;
}

export interface FinanceDashboardData {
  currentMoney: number;
  availableMoney: number;
  pendingCount: number;
  homeRamUsed: number;
  homeRamTotal: number;
  homeCores: number;
  purchasedServerCount: number;
  purchasedServerLimit: number;
  largestPurchasedServerName: string;
  largestPurchasedServerRam: number;
  hacknetCount: number;
  hacknetLimit: number;
  isHacknetServer: boolean;
  financeManagerActive: boolean;
  suiteManagerActive: boolean;
  activeEvaluators: string[];
  inactiveEvaluators: string[];
  nextPurchaseRequest?: PendingRequestSummary;
  topPendingRequests: PendingRequestSummary[];
  lastPurchases: string[];
  lastWarnings: string[];
}

function makeProgressBar(value: number, max: number, width = 20): string {
  if (max <= 0) return "░".repeat(width);
  const ratio = Math.max(0, Math.min(value, max)) / max;
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function formatPercent(value: number, max: number): string {
  if (max <= 0) return "0.0%";
  const pct = (Math.max(0, Math.min(value, max)) / max) * 100;
  return `${pct.toFixed(1)}%`;
}

export function drawFinanceDashboard(ns: NS, data: FinanceDashboardData): void {
  ns.clearLog();

  const W = 64;
  const H_LINE = "=".repeat(W);
  const D_LINE = "-".repeat(W);

  // ------------------------------------------------------------
  // HEADER (BIT-OS DESIGN)
  // ------------------------------------------------------------
  const queueStr = `Queue: ${data.pendingCount} Anfragen`;
  const headerTitle = `⚡ BIT-OS FINANCE CORE v1.0`;
  const headerContent = `${headerTitle.padEnd(34)}|  ${queueStr}`;

  ns.print(H_LINE);
  ns.print(headerContent);
  ns.print(H_LINE);

  // ------------------------------------------------------------
  // 1. FINANZ- & SYSTEM-ÜBERSICHT
  // ------------------------------------------------------------
  const cashStr = `$${ns.format.number(data.currentMoney)}`;
  const budgetStr = `$${ns.format.number(data.availableMoney)}`;
  ns.print(`FINANZ- & SYSTEM-ÜBERSICHT:`);
  ns.print(`Cash:        ${cashStr}  |  Budget: ${budgetStr}`);

  const ramUsedStr = ns.format.ram(data.homeRamUsed);
  const ramTotStr = ns.format.ram(data.homeRamTotal);
  const ramPct = formatPercent(data.homeRamUsed, data.homeRamTotal);
  const ramBar = makeProgressBar(data.homeRamUsed, data.homeRamTotal, 20);
  ns.print(`Home RAM:    ${ramUsedStr} / ${ramTotStr} (${ramPct})`);
  ns.print(`             [${ramBar}]`);

  const pservStr = `${data.purchasedServerCount} / ${data.purchasedServerLimit}`;
  const pservBar = makeProgressBar(
    data.purchasedServerCount,
    data.purchasedServerLimit,
    12,
  );
  const maxRamStr =
    data.largestPurchasedServerRam > 0
      ? ns.format.ram(data.largestPurchasedServerRam)
      : "–";
  ns.print(
    `Pserv Pool:  ${pservStr.padEnd(8)} [${pservBar}] (Max: ${maxRamStr})`,
  );

  if (data.hacknetLimit > 0) {
    const hnetStr = `${data.hacknetCount} / ${data.hacknetLimit}`;
    const hnetBar = makeProgressBar(
      data.hacknetCount,
      data.hacknetLimit,
      12,
    );
    const modeLabel = data.isHacknetServer ? "Servers" : "Nodes";
    ns.print(
      `Hacknet Pool:${hnetStr.padEnd(8)} [${hnetBar}] (${modeLabel})`,
    );
  }

  ns.print(
    `Home Cores:  ${data.homeCores} Core${data.homeCores > 1 ? "s" : ""}`,
  );

  ns.print(D_LINE);

  // ------------------------------------------------------------
  // 2. SUPERVISOR & EVALUATOREN STATUS
  // ------------------------------------------------------------
  const fMgrStatus = data.financeManagerActive ? "[ONLINE]" : "[OFFLINE]";
  const sMgrStatus = data.suiteManagerActive ? "[ONLINE]" : "[OFFLINE]";
  ns.print(`SUPERVISOR & EVALUATOREN STATUS:`);
  ns.print(`Manager:     ${fMgrStatus.padEnd(10)} |  Suite: ${sMgrStatus}`);

  const allEvaluators = [
    "home",
    "hacknet",
    "stock",
    "pserv",
    "programs",
    "gang",
    "sleeve",
    "player",
  ];
  const activeSet = new Set(data.activeEvaluators);

  const badges = allEvaluators.map((name) => {
    const icon = activeSet.has(name) ? "[✓]" : "[✗]";
    return `${icon} ${name}`.padEnd(13);
  });

  // Grid ausgeben (4 Stück pro Zeile)
  ns.print(`Evaluatoren: ${badges.slice(0, 4).join("")}`);
  ns.print(`             ${badges.slice(4, 8).join("")}`);

  ns.print(D_LINE);

  // ------------------------------------------------------------
  // 3. NÄCHSTER GEPLANTER KAUF
  // ------------------------------------------------------------
  ns.print(`NÄCHSTER GEPLANTER KAUF:`);
  if (data.nextPurchaseRequest) {
    const req = data.nextPurchaseRequest;
    const reqCostStr = `$${ns.format.number(req.cost)}`;
    const progressPct = Math.min(100, (data.currentMoney / req.cost) * 100);
    const progressBar = makeProgressBar(data.currentMoney, req.cost, 20);
    const shortDesc =
      req.description.length > 44
        ? req.description.substring(0, 41) + "..."
        : req.description;

    ns.print(`Ziel:        ${shortDesc}`);
    ns.print(`Kosten:      ${reqCostStr} (${progressPct.toFixed(1)}%)`);
    ns.print(
      `Status:      [${progressBar}] ${progressPct >= 100 ? "Bereit!" : "Sparen..."}`,
    );
  } else {
    ns.print(`Ziel:        Keine offenen Anfragen im Port`);
    ns.print(`Status:      [${makeProgressBar(1, 1, 20)}] Bereit`);
  }

  ns.print(D_LINE);

  // ------------------------------------------------------------
  // 4. TOP ANFRAGEN IN WARTESCHLANGE
  // ------------------------------------------------------------
  ns.print(`TOP ANFRAGEN IN WARTESCHLANGE:`);
  if (data.topPendingRequests.length === 0) {
    ns.print(`> Keine wartenden Anfragen.`);
  } else {
    for (const req of data.topPendingRequests) {
      const prio = req.priorityLabel.substring(0, 4).padEnd(4);
      const cat = req.category.substring(0, 14).padEnd(14);
      const cost = `$${ns.format.number(req.cost)}`;
      const desc =
        req.description.length > 22
          ? req.description.substring(0, 19) + "..."
          : req.description;
      ns.print(`> [${prio}] ${cat} | ${desc.padEnd(22)} ${cost.padStart(9)}`);
    }
  }

  ns.print(D_LINE);

  // ------------------------------------------------------------
  // 5. EREIGNIS-PROTOKOLL
  // ------------------------------------------------------------
  ns.print(`EREIGNIS-PROTOKOLL:`);
  const recentLogs: string[] = [];

  for (const p of data.lastPurchases.slice(-3)) {
    recentLogs.push(p);
  }
  for (const w of data.lastWarnings.slice(-2)) {
    recentLogs.push(w);
  }

  if (recentLogs.length === 0) {
    ns.print(`> Keine aktuellen Ereignisse.`);
  } else {
    for (const logLine of recentLogs.slice(-4)) {
      const truncated =
        logLine.length > 58 ? logLine.substring(0, 55) + "..." : logLine;
      ns.print(`> ${truncated}`);
    }
  }

  ns.print(H_LINE);
}