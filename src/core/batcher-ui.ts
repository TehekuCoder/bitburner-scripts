import { NS } from "@ns";

export interface DashboardData {
  status: string;
  target: string;
  progress: number;
  progressText: string;
  greed: number;
  ramNeeded: number;
  ramFree: number;
  ramTotal: number;
  batchesSent: number;
  batchesMax: number;
  eventLog: string[];
  lastWaveProfit: number;
}

function makeProgressBar(progress: number, width = 20): string {
  const filledLength = Math.round(Math.max(0, Math.min(1, progress)) * width);
  const emptyLength = width - filledLength;
  return "█".repeat(filledLength) + "░".repeat(emptyLength);
}

export function drawBatcherDashboard(ns: NS, data: DashboardData): void {
  ns.clearLog();

  const hasValidTarget = data.target !== "Keines" && data.target !== "";
  const curSec = hasValidTarget ? ns.getServerSecurityLevel(data.target) : 0;
  const minSec = hasValidTarget ? ns.getServerMinSecurityLevel(data.target) : 0;
  const curMoney = hasValidTarget ? ns.getServerMoneyAvailable(data.target) : 0;
  const maxMoney = hasValidTarget ? ns.getServerMaxMoney(data.target) : 0;

  const moneyPercent = maxMoney > 0 ? (curMoney / maxMoney) * 100 : 0;
  const ramUsed = data.ramTotal - data.ramFree;
  const ramPercent = data.ramTotal > 0 ? (ramUsed / data.ramTotal) * 100 : 0;
  const bar = makeProgressBar(data.progress, 20);

  ns.print(`============================================================`);
  ns.print(`⚡ BIT-OS DYNAMIC BATCHER v2.2     |  Gewinn/Welle: +$${ns.format.number(data.lastWaveProfit)}`);
  ns.print(`============================================================`);
  ns.print(`FOKUS-ZIEL:      ${data.target}`);
  ns.print(`STATUS:          [${bar}] ${data.status}`);
  ns.print(`DETAILS:         ${data.progressText}`);
  ns.print(`------------------------------------------------------------`);
  ns.print(`NETZWERK-ALLOKATION:`);
  ns.print(`RAM Pool:    ${ns.format.ram(ramUsed)} / ${ns.format.ram(data.ramTotal)} (${ramPercent.toFixed(1)}%)`);
  ns.print(`Wellen-Ram:  ${ns.format.ram(data.ramNeeded)} Benötigt | Frei gepoolt: ${ns.format.ram(data.ramFree)}`);
  ns.print(`------------------------------------------------------------`);
  ns.print(`ZIELSERVER-ZUSTAND:`);
  ns.print(`Sicherheit:  ${curSec.toFixed(2)} / ${minSec.toFixed(2)} (Min)`);
  ns.print(`Finanzen:    $${ns.format.number(curMoney)} / $${ns.format.number(maxMoney)} (${moneyPercent.toFixed(1)}%)`);
  ns.print(`------------------------------------------------------------`);
  ns.print(`EREIGNIS-PROTOKOLL:`);
  if (data.eventLog.length === 0) {
    ns.print(`> Warte auf Systemereignisse...`);
  } else {
    for (const log of data.eventLog) {
      ns.print(`> ${log}`);
    }
  }
  ns.print(`============================================================`);
}