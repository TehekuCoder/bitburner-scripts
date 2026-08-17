// ui/finance-ui.ts
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
  sysOrchestratorActive: boolean;
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

  // ANSI-Farbcodes für Bitburner Tail-Fenster
  const CLR = {
    RESET: "\u001b[0m",
    CYAN: "\u001b[36m",
    GREEN: "\u001b[32m",
    YELLOW: "\u001b[33m",
    RED: "\u001b[31m",
    GRAY: "\u001b[90m",
    WHITE_BOLD: "\u001b[1;37m",
  };

  const W = 64;
  const H_LINE = `${CLR.GRAY}${"=".repeat(W)}${CLR.RESET}`;
  const D_LINE = `${CLR.GRAY}${"-".repeat(W)}${CLR.RESET}`;

  // ------------------------------------------------------------
  // HEADER (BIT-OS DESIGN)
  // ------------------------------------------------------------
  const queueStr = `Queue: ${data.pendingCount} Anfragen`;
  const headerTitle = `⚡ BIT-OS FINANCE CORE v1.0`;
  const headerContent = `${CLR.WHITE_BOLD}${headerTitle.padEnd(34)}${CLR.RESET}|  ${CLR.CYAN}${queueStr}${CLR.RESET}`;

  ns.print(H_LINE);
  ns.print(headerContent);
  ns.print(H_LINE);

  // ------------------------------------------------------------
  // 1. FINANZ- & SYSTEM-ÜBERSICHT
  // ------------------------------------------------------------
  const cashStr = `${CLR.GREEN}$${ns.format.number(data.currentMoney)}${CLR.RESET}`;
  const budgetStr = `${CLR.CYAN}$${ns.format.number(data.availableMoney)}${CLR.RESET}`;
  ns.print(`${CLR.WHITE_BOLD}FINANZ- & SYSTEM-ÜBERSICHT:${CLR.RESET}`);
  ns.print(`Cash:        ${cashStr}  |  Budget: ${budgetStr}`);

  const ramUsedStr = ns.format.ram(data.homeRamUsed);
  const ramTotStr = ns.format.ram(data.homeRamTotal);
  const ramPct = formatPercent(data.homeRamUsed, data.homeRamTotal);
  const ramBar = makeProgressBar(data.homeRamUsed, data.homeRamTotal, 20);
  ns.print(`Home RAM:    ${ramUsedStr} / ${ramTotStr} (${ramPct})`);
  ns.print(`             [${CLR.CYAN}${ramBar}${CLR.RESET}]`);

  const CloudStr = `${data.purchasedServerCount} / ${data.purchasedServerLimit}`;
  const CloudBar = makeProgressBar(
    data.purchasedServerCount,
    data.purchasedServerLimit,
    12,
  );
  const maxRamStr =
    data.largestPurchasedServerRam > 0
      ? ns.format.ram(data.largestPurchasedServerRam)
      : "–";
  ns.print(
    `Cloud Pool:  ${CloudStr.padEnd(8)} [${CLR.CYAN}${CloudBar}${CLR.RESET}] (Max: ${maxRamStr})`,
  );

  if (data.hacknetLimit > 0) {
    const hnetStr = `${data.hacknetCount} / ${data.hacknetLimit}`;
    const hnetBar = makeProgressBar(data.hacknetCount, data.hacknetLimit, 12);
    const modeLabel = data.isHacknetServer ? "Servers" : "Nodes";
    ns.print(
      `Hacknet Pool:${hnetStr.padEnd(8)} [${CLR.CYAN}${hnetBar}${CLR.RESET}] (${modeLabel})`,
    );
  }

  ns.print(
    `Home Cores:  ${data.homeCores} Core${data.homeCores > 1 ? "s" : ""}`,
  );

  ns.print(D_LINE);

  // ------------------------------------------------------------
  // 2. SUPERVISOR & EVALUATOREN STATUS
  // ------------------------------------------------------------
  const fMgrStatus = data.financeManagerActive
    ? `${CLR.GREEN}[ONLINE]${CLR.RESET}`
    : `${CLR.RED}[OFFLINE]${CLR.RESET}`;
  const sMgrStatus = data.sysOrchestratorActive
    ? `${CLR.GREEN}[ONLINE]${CLR.RESET}`
    : `${CLR.RED}[OFFLINE]${CLR.RESET}`;

  ns.print(`${CLR.WHITE_BOLD}SUPERVISOR & EVALUATOREN STATUS:${CLR.RESET}`);
  ns.print(
    `Manager:     ${fMgrStatus.padEnd(19)} |  Orchestrator: ${sMgrStatus}`,
  );

  const allEvaluators = [
    "home",
    "hacknet",
    "stock",
    "cloud",
    "programs",
    "gang",
    "sleeve",
    "player",
  ];
  const activeSet = new Set(data.activeEvaluators);

  const badges = allEvaluators.map((name) => {
    const isActive = activeSet.has(name);
    const icon = isActive
      ? `${CLR.GREEN}[✓]${CLR.RESET}`
      : `${CLR.RED}[✗]${CLR.RESET}`;
    const label = `${icon} ${name}`;
    // Breite exakt 12 sichtbare Zeichen für perfektes 4er-Grid bei W=64
    return isActive ? label.padEnd(20) : label.padEnd(19);
  });

  ns.print(`Evaluatoren: ${badges.slice(0, 4).join("")}`);
  ns.print(`             ${badges.slice(4, 8).join("")}`);

  ns.print(D_LINE);

  // ------------------------------------------------------------
  // 3. NÄCHSTER GEPLANTER KAUF
  // ------------------------------------------------------------
  ns.print(`${CLR.WHITE_BOLD}NÄCHSTER GEPLANTER KAUF:${CLR.RESET}`);
  if (data.nextPurchaseRequest) {
    const req = data.nextPurchaseRequest;
    const reqCostStr = `$${ns.format.number(req.cost)}`;
    const progressPct =
      req.cost > 0 ? Math.min(100, (data.currentMoney / req.cost) * 100) : 100;
    const progressBar = makeProgressBar(data.currentMoney, req.cost, 20);
    const shortDesc =
      req.description.length > 44
        ? req.description.substring(0, 41) + "..."
        : req.description;

    const statusStr =
      progressPct >= 100
        ? `${CLR.GREEN}Bereit!${CLR.RESET}`
        : `${CLR.YELLOW}Sparen...${CLR.RESET}`;

    ns.print(`Ziel:        ${shortDesc}`);
    ns.print(`Kosten:      ${reqCostStr} (${progressPct.toFixed(1)}%)`);
    ns.print(
      `Status:      [${CLR.CYAN}${progressBar}${CLR.RESET}] ${statusStr}`,
    );
  } else {
    ns.print(`Ziel:        Keine offenen Anfragen im Port`);
    ns.print(
      `Status:      [${CLR.GREEN}${makeProgressBar(1, 1, 20)}${CLR.RESET}] Bereit`,
    );
  }

  ns.print(D_LINE);

  // ------------------------------------------------------------
  // 4. TOP ANFRAGEN IN WARTESCHLANGE
  // ------------------------------------------------------------
  ns.print(`${CLR.WHITE_BOLD}TOP ANFRAGEN IN WARTESCHLANGE:${CLR.RESET}`);
  if (data.topPendingRequests.length === 0) {
    ns.print(`> ${CLR.GRAY}Keine wartenden Anfragen.${CLR.RESET}`);
  } else {
    for (const req of data.topPendingRequests) {
      const prio = req.priorityLabel.substring(0, 4).padEnd(4);
      const cat = req.category.substring(0, 14).padEnd(14);
      const cost = `$${ns.format.number(req.cost)}`;
      const desc =
        req.description.length > 22
          ? req.description.substring(0, 19) + "..."
          : req.description;
      ns.print(
        `> [${CLR.CYAN}${prio}${CLR.RESET}] ${cat} | ${desc.padEnd(22)} ${cost.padStart(9)}`,
      );
    }
  }

  ns.print(D_LINE);

  // ------------------------------------------------------------
  // 5. EREIGNIS-PROTOKOLL
  // ------------------------------------------------------------
  ns.print(`${CLR.WHITE_BOLD}EREIGNIS-PROTOKOLL:${CLR.RESET}`);
  const recentLogs: string[] = [];

  for (const p of data.lastPurchases.slice(-3)) {
    recentLogs.push(p);
  }
  for (const w of data.lastWarnings.slice(-2)) {
    recentLogs.push(w);
  }

  if (recentLogs.length === 0) {
    ns.print(`> ${CLR.GRAY}Keine aktuellen Ereignisse.${CLR.RESET}`);
  } else {
    for (const logLine of recentLogs.slice(-4)) {
      const truncated =
        logLine.length > 58 ? logLine.substring(0, 55) + "..." : logLine;
      ns.print(`> ${truncated}`);
    }
  }

  ns.print(H_LINE);
}
