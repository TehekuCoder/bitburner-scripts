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

const ANSI_REGEX = /\u001b\[[0-9;]*m/g;

/**
 * Tag-Mapping für prägnante UI-Kategorie-Kürzel.
 */
const CATEGORY_TAGS: Record<string, string> = {
  HOME_RAM: "RAM",
  HOME_CORES: "COR",
  SERVER_BUY: "SRV",
  SERVER_UPGRADE: "SRV",
  HACKNET: "HNK",
  DARKNET_PROGRAM: "DRK",
  STOCK_LICENSE: "STK",
  GANG_EQUIPMENT: "GNG",
  GANG_AUG: "GAUG",
  SLEEVE_AUG: "SLV",
  PLAYER_AUG: "AUG",
  CORP_FOUND: "CRP",
};

/**
 * Bereinigt unknackige Textmonster und verhindert doppelte Akronyme.
 */
function cleanupDescription(desc: string): string {
  return desc
    .replace(/^Software:\s*/i, "")
    .replace(/^Gang '[^']+':\s*/i, "")
    .replace(/\s*\(Börsen-Automatisierung\)/i, "");
}

/**
 * Filtert doppelte Log-Einträge heraus, selbst wenn sich Beträge leicht unterscheiden.
 */
function filterUniqueLogs(logs: string[]): string[] {
  const seenKeys = new Set<string>();
  const result: string[] = [];

  for (let i = logs.length - 1; i >= 0; i--) {
    const rawLog = logs[i];
    const normalizedKey = rawLog
      .replace(/\(\$\d+(\.\d+)?[a-z]?\s*\/\s*\$\d+(\.\d+)?[a-z]?\)/i, "")
      .trim();

    if (!seenKeys.has(normalizedKey)) {
      seenKeys.add(normalizedKey);
      result.unshift(rawLog);
    }
  }

  return result;
}

function getVisibleLength(text: string): number {
  return text.replace(ANSI_REGEX, "").length;
}

function padANSI(
  text: string,
  visibleWidth: number,
  alignRight = false,
): string {
  const missing = Math.max(0, visibleWidth - getVisibleLength(text));
  const padding = " ".repeat(missing);
  return alignRight ? padding + text : text + padding;
}

function truncateANSI(text: string, maxWidth: number): string {
  if (getVisibleLength(text) <= maxWidth) return text;

  let visibleCount = 0;
  let result = "";
  let i = 0;

  while (i < text.length && visibleCount < maxWidth - 3) {
    if (text[i] === "\u001b") {
      const match = text.slice(i).match(/^(\u001b\[[0-9;]*m)/);
      if (match) {
        result += match[0];
        i += match[0].length;
        continue;
      }
    }
    result += text[i];
    visibleCount++;
    i++;
  }
  return result + "...\u001b[0m";
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
  const buffer: string[] = [];

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
  // HEADER
  // ------------------------------------------------------------
  const queueStr = `Queue: ${data.pendingCount} Anfragen`;
  const headerTitle = `⚡ BIT-OS FINANCE CORE v1.0`;
  const headerContent = `${CLR.WHITE_BOLD}${padANSI(headerTitle, 36)}${CLR.RESET}| ${CLR.CYAN}${padANSI(queueStr, 24, true)}${CLR.RESET}`;

  buffer.push(H_LINE);
  buffer.push(headerContent);
  buffer.push(H_LINE);

  // ------------------------------------------------------------
  // 1. FINANZ- & SYSTEM-ÜBERSICHT
  // ------------------------------------------------------------
  const cashStr = `${CLR.GREEN}$${ns.format.number(data.currentMoney)}${CLR.RESET}`;
  const budgetStr = `${CLR.CYAN}$${ns.format.number(data.availableMoney)}${CLR.RESET}`;
  buffer.push(`${CLR.WHITE_BOLD}FINANZ- & SYSTEM-ÜBERSICHT:${CLR.RESET}`);
  buffer.push(`Cash:        ${padANSI(cashStr, 18)} | Budget: ${budgetStr}`);

  const ramUsedStr = ns.format.ram(data.homeRamUsed);
  const ramTotStr = ns.format.ram(data.homeRamTotal);
  const ramPct = formatPercent(data.homeRamUsed, data.homeRamTotal);
  const ramBar = makeProgressBar(data.homeRamUsed, data.homeRamTotal, 20);
  buffer.push(`Home RAM:    ${ramUsedStr} / ${ramTotStr} (${ramPct})`);
  buffer.push(`             [${CLR.CYAN}${ramBar}${CLR.RESET}]`);

  const cloudStr = `${data.purchasedServerCount} / ${data.purchasedServerLimit}`;
  const cloudBar = makeProgressBar(
    data.purchasedServerCount,
    data.purchasedServerLimit,
    12,
  );
  const maxRamStr =
    data.largestPurchasedServerRam > 0
      ? ns.format.ram(data.largestPurchasedServerRam)
      : "–";
  buffer.push(
    `Cloud Pool:  ${padANSI(cloudStr, 8)} [${CLR.CYAN}${cloudBar}${CLR.RESET}] (Max: ${maxRamStr})`,
  );

  if (data.hacknetLimit > 0) {
    const hnetStr = `${data.hacknetCount} / ${data.hacknetLimit}`;
    const hnetBar = makeProgressBar(data.hacknetCount, data.hacknetLimit, 12);
    const modeLabel = data.isHacknetServer ? "Servers" : "Nodes";
    buffer.push(
      `Hacknet Pool:${padANSI(hnetStr, 8)} [${CLR.CYAN}${hnetBar}${CLR.RESET}] (${modeLabel})`,
    );
  }

  buffer.push(
    `Home Cores:  ${data.homeCores} Core${data.homeCores > 1 ? "s" : ""}`,
  );
  buffer.push(D_LINE);

  // ------------------------------------------------------------
  // 2. SUPERVISOR & EVALUATOREN STATUS
  // ------------------------------------------------------------
  const fMgrStatus = data.financeManagerActive
    ? `${CLR.GREEN}[ONLINE]${CLR.RESET}`
    : `${CLR.RED}[OFFLINE]${CLR.RESET}`;
  const sMgrStatus = data.sysOrchestratorActive
    ? `${CLR.GREEN}[ONLINE]${CLR.RESET}`
    : `${CLR.RED}[OFFLINE]${CLR.RESET}`;

  buffer.push(`${CLR.WHITE_BOLD}SUPERVISOR & EVALUATOREN STATUS:${CLR.RESET}`);
  buffer.push(
    `Manager:     ${padANSI(fMgrStatus, 18)} | Orchestrator: ${sMgrStatus}`,
  );

  const activeSet = new Set(data.activeEvaluators);
  const allEvaluators = Array.from(
    new Set([...data.activeEvaluators, ...data.inactiveEvaluators]),
  ).sort();

  const badges = allEvaluators.map((name) => {
    const isActive = activeSet.has(name);
    const icon = isActive
      ? `${CLR.GREEN}[✓]${CLR.RESET}`
      : `${CLR.RED}[✗]${CLR.RESET}`;
    return padANSI(`${icon} ${name}`, 16);
  });

  for (let i = 0; i < badges.length; i += 3) {
    const row = badges.slice(i, i + 3).join("");
    const prefix = i === 0 ? "Evaluatoren: " : "             ";
    buffer.push(`${prefix}${row}`);
  }

  buffer.push(D_LINE);

  // ------------------------------------------------------------
  // 3. NÄCHSTER GEPLANTER KAUF
  // ------------------------------------------------------------
  buffer.push(`${CLR.WHITE_BOLD}NÄCHSTER GEPLANTER KAUF:${CLR.RESET}`);
  if (data.nextPurchaseRequest) {
    const req = data.nextPurchaseRequest;
    const reqCostStr = `$${ns.format.number(req.cost)}`;
    const progressPct =
      req.cost > 0 ? Math.min(100, (data.currentMoney / req.cost) * 100) : 100;
    const progressBar = makeProgressBar(data.currentMoney, req.cost, 20);
    const shortDesc = truncateANSI(cleanupDescription(req.description), 44);
    const statusStr =
      progressPct >= 100
        ? `${CLR.GREEN}Bereit!${CLR.RESET}`
        : `${CLR.YELLOW}Sparen...${CLR.RESET}`;

    buffer.push(`Ziel:        ${shortDesc}`);
    buffer.push(`Kosten:      ${reqCostStr} (${progressPct.toFixed(1)}%)`);
    buffer.push(
      `Status:      [${CLR.CYAN}${progressBar}${CLR.RESET}] ${statusStr}`,
    );
  } else {
    buffer.push(`Ziel:        Keine offenen Anfragen im Port`);
    buffer.push(
      `Status:      [${CLR.GREEN}${makeProgressBar(1, 1, 20)}${CLR.RESET}] Bereit`,
    );
  }

  buffer.push(D_LINE);

  // ------------------------------------------------------------
  // 4. TOP ANFRAGEN IN WARTESCHLANGE
  // ------------------------------------------------------------
  buffer.push(`${CLR.WHITE_BOLD}TOP ANFRAGEN IN WARTESCHLANGE:${CLR.RESET}`);
  if (data.topPendingRequests.length === 0) {
    buffer.push(`> ${CLR.GRAY}Keine wartenden Anfragen.${CLR.RESET}`);
  } else {
    for (const req of data.topPendingRequests) {
      const prio = req.priorityLabel.substring(0, 4);
      const catTag =
        CATEGORY_TAGS[req.category] ?? req.category.substring(0, 3);
      const cleanDesc = cleanupDescription(req.description);
      const costStr = `$${ns.format.number(req.cost)}`;
      const shortDesc = truncateANSI(cleanDesc, 36);

      buffer.push(
        `> [${CLR.CYAN}${prio}${CLR.RESET}] [${CLR.YELLOW}${catTag}${CLR.RESET}] ${padANSI(shortDesc, 36)} ${padANSI(costStr, 9, true)}`,
      );
    }
  }

  buffer.push(D_LINE);

  // ------------------------------------------------------------
  // 5. EREIGNIS-PROTOKOLL
  // ------------------------------------------------------------
  buffer.push(`${CLR.WHITE_BOLD}EREIGNIS-PROTOKOLL:${CLR.RESET}`);

  const combinedLogs = [...data.lastPurchases, ...data.lastWarnings];
  const uniqueLogs = filterUniqueLogs(combinedLogs).slice(-4);

  if (uniqueLogs.length === 0) {
    buffer.push(`> ${CLR.GRAY}Keine aktuellen Ereignisse.${CLR.RESET}`);
  } else {
    for (const logLine of uniqueLogs) {
      const cleanedLog = cleanupDescription(logLine);
      buffer.push(`> ${truncateANSI(cleanedLog, 58)}`);
    }
  }

  buffer.push(H_LINE);

  ns.print(buffer.join("\n"));
}