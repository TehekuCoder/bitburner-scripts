import { NS } from "@ns";

export interface ShotgunDashboardData {
  target: string;
  status: string;
  ramUsed: number;
  ramTotal: number;
  activeWaves: number;
  activeThreads: {
    hack: number;
    grow: number;
    weaken: number;
    total: number;
  };
  targetStats: {
    curSec: number;
    minSec: number;
    curMoney: number;
    maxMoney: number;
  };
  eventLog: string[];
}

function makeProgressBar(progress: number, width = 20): string {
  const filledLength = Math.round(Math.max(0, Math.min(1, progress)) * width);
  const emptyLength = width - filledLength;
  return "█".repeat(filledLength) + "░".repeat(emptyLength);
}

function makeThreadDistributionBar(h: number, g: number, w: number, total: number, width = 30): string {
  if (total === 0) return "░".repeat(width);
  const hLen = Math.round((h / total) * width);
  const gLen = Math.round((g / total) * width);
  const wLen = Math.max(0, width - hLen - gLen);
  
  return "🪓".repeat(0) + "█".repeat(hLen) + "🟩".repeat(0) + "▒".repeat(gLen) + "░".repeat(wLen);
}

export function drawShotgunDashboard(ns: NS, data: ShotgunDashboardData): void {
  ns.clearLog();

  const { curSec, minSec, curMoney, maxMoney } = data.targetStats;
  const moneyPercent = maxMoney > 0 ? (curMoney / maxMoney) * 100 : 0;
  const ramPercent = data.ramTotal > 0 ? (data.ramUsed / data.ramTotal) * 100 : 0;
  const ramBar = makeProgressBar(ramPercent / 100, 20);

  const { hack, grow, weaken, total } = data.activeThreads;
  const threadDistBar = makeThreadDistributionBar(hack, grow, weaken, total, 24);

  ns.print(`============================================================`);
  ns.print(`💥 BIT-OS SHOTGUN WAVE MONITOR v1.0`);
  ns.print(`============================================================`);
  ns.print(`FOKUS-ZIEL:      ${data.target}`);
  ns.print(`STATUS:          ${data.status}`);
  ns.print(`AKTIVE WELLEN:   ${data.activeWaves} Wellen im Orbit`);
  ns.print(`------------------------------------------------------------`);
  ns.print(`NETZWERK RAM ALLOKATION:`);
  ns.print(`Auslastung:      [${ramBar}] ${ramPercent.toFixed(1)}%`);
  ns.print(`RAM Pool:        ${ns.format.ram(data.ramUsed)} / ${ns.format.ram(data.ramTotal)}`);
  ns.print(`------------------------------------------------------------`);
  ns.print(`L AUFENDE THREADS (GESAMT: ${ns.format.number(total)}):`);
  ns.print(`Verteilung:      [${threadDistBar}]`);
  ns.print(`  🪓 Hack:   ${ns.format.number(hack).padStart(7)} threads (${total > 0 ? ((hack/total)*100).toFixed(1) : 0}%)`);
  ns.print(`  🌱 Grow:   ${ns.format.number(grow).padStart(7)} threads (${total > 0 ? ((grow/total)*100).toFixed(1) : 0}%)`);
  ns.print(`  🛡️ Weaken: ${ns.format.number(weaken).padStart(7)} threads (${total > 0 ? ((weaken/total)*100).toFixed(1) : 0}%)`);
  ns.print(`------------------------------------------------------------`);
  ns.print(`ZIELSERVER-ZUSTAND:`);
  ns.print(`Sicherheit:      ${curSec.toFixed(2)} / ${minSec.toFixed(2)} (Min)`);
  ns.print(`Finanzen:        $${ns.format.number(curMoney)} / $${ns.format.number(maxMoney)} (${moneyPercent.toFixed(1)}%)`);
  ns.print(`------------------------------------------------------------`);
  ns.print(`SHOTGUN LOG PROTOKOLL:`);
  if (data.eventLog.length === 0) {
    ns.print(`> Warte auf Shotgun-Salven...`);
  } else {
    for (const log of data.eventLog) {
      ns.print(`> ${log}`);
    }
  }
  ns.print(`============================================================`);
}