import { NS } from "@ns";

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
  financeManagerActive: boolean;
  suiteManagerActive: boolean;
  activeEvaluators: string[];
  inactiveEvaluators: string[];
  nextPurchase: string;
  topPendingRequestLines: string[];
  lastPurchases: string[];
  lastWarnings: string[];
}

function makeShortProgressBar(value: number, max: number, width = 16): string {
  const filled = Math.round((Math.max(0, Math.min(value, max)) / Math.max(1, max)) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function drawFinanceDashboard(ns: NS, data: FinanceDashboardData): void {
  ns.clearLog();
  ns.print("============================================================");
  ns.print("⚡ FINANCE-CORE MONITOR");
  ns.print("============================================================");
  ns.print(`Home-Cash:    $${ns.format.number(data.currentMoney)}`);
  ns.print(`Budget:       $${ns.format.number(data.availableMoney)}`);
  ns.print(`Anfragen:     ${data.pendingCount}`);
  ns.print("------------------------------------------------------------");
  ns.print("🏠 Home-System:");
  ns.print(`   RAM:   ${ns.format.ram(data.homeRamUsed).padEnd(9)} / ${ns.format.ram(data.homeRamTotal).padEnd(9)} ${makeShortProgressBar(data.homeRamUsed, data.homeRamTotal)}`);
  ns.print(`   CORES: ${data.homeCores}`);
  ns.print("------------------------------------------------------------");
  ns.print("🧠 Finance Supervisor:");
  ns.print(`   Finance-Manager: ${data.financeManagerActive ? "ONLINE" : "offline"}`);
  ns.print(`   Suite-Manager: ${data.suiteManagerActive ? "ONLINE" : "offline"}`);
  ns.print(`   Evaluatoren: ${data.activeEvaluators.length}/${data.activeEvaluators.length + data.inactiveEvaluators.length} aktiv`);
  if (data.activeEvaluators.length > 0) {
    ns.print(`   ${data.activeEvaluators.join(", ")}`);
  }
  if (data.inactiveEvaluators.length > 0) {
    ns.print(`   offline: ${data.inactiveEvaluators.join(", ")}`);
  }
  ns.print("------------------------------------------------------------");
  ns.print("🖥️  Purchased Server Summary:");
  ns.print(`   Server: ${data.purchasedServerCount} / ${data.purchasedServerLimit}`);
  ns.print(`   Größter Server: ${data.largestPurchasedServerName} (${ns.format.ram(data.largestPurchasedServerRam)})`);
  ns.print("------------------------------------------------------------");
  ns.print("⏭️ Nächster geplanter Kauf:");
  ns.print(`   ${data.nextPurchase}`);
  ns.print("------------------------------------------------------------");
  ns.print("📌 Top offene Anfragen:");
  if (data.topPendingRequestLines.length === 0) {
    ns.print("> Keine offenen Finanzanfragen.");
  } else {
    for (const line of data.topPendingRequestLines) {
      ns.print(`> ${line}`);
    }
  }
  ns.print("------------------------------------------------------------");
  ns.print("LETZTE KÄUFE:");
  if (data.lastPurchases.length === 0) {
    ns.print("> Keine Käufe.");
  } else {
    for (const purchase of data.lastPurchases.slice(-4)) {
      ns.print(`> ${purchase}`);
    }
  }
  ns.print("------------------------------------------------------------");
  ns.print("WARNUNGEN:");
  if (data.lastWarnings.length === 0) {
    ns.print("> Keine Warnungen.");
  } else {
    for (const warning of data.lastWarnings.slice(-4)) {
      ns.print(`> ${warning}`);
    }
  }
  ns.print("============================================================");
}
