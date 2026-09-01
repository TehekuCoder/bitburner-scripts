import { NS } from "@ns";
import { formatPercent } from "/lib/utils.js";

export interface EngineDashboardData {
  engineName: string; // "PREP" | "PROTO" | "SHOTGUN" | "XP-GRIND" | "STANDBY"
  target: string;
  status: string;
  ramUsed: number;
  ramTotal: number;
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

export function drawEngineDashboard(ns: NS, data: EngineDashboardData): void {
  ns.clearLog();

  const { curSec, minSec, curMoney, maxMoney } = data.targetStats;
  const moneyPercent = maxMoney > 0 ? (curMoney / maxMoney) * 100 : 0;
  const ramPercent = data.ramTotal > 0 ? (data.ramUsed / data.ramTotal) * 100 : 0;

  const { hack, grow, weaken, total } = data.activeThreads;

  ns.print(`============================================================`);
  ns.print(`⚡ BIT-OS ENGINE MONITOR 2.0  |  MODUS: [${data.engineName.padEnd(8, " ")}]`);
  ns.print(`============================================================`);
  ns.print(`FOKUS-ZIEL:      ${data.target}`);
  ns.print(`STATUS:          ${data.status}`);
  ns.print(`------------------------------------------------------------`);
  ns.print(`NETZWERK ALLOKATION:`);
  ns.print(`RAM Pool:        ${ns.format.ram(data.ramUsed)} / ${ns.format.ram(data.ramTotal)} (${ramPercent.toFixed(1)}%)`);
  ns.print(`------------------------------------------------------------`);
  ns.print(`LAUFENDE THREADS (GESAMT: ${ns.format.number(total)}):`);
  ns.print(`   🪓 Hack:   ${ns.format.number(hack).padStart(7)} threads (${total > 0 ? ((hack / total) * 100).toFixed(1) : 0}%)`);
  ns.print(`   🌱 Grow:   ${ns.format.number(grow).padStart(7)} threads (${total > 0 ? ((grow / total) * 100).toFixed(1) : 0}%)`);
  ns.print(`   🛡️ Weaken: ${ns.format.number(weaken).padStart(7)} threads (${total > 0 ? ((weaken / total) * 100).toFixed(1) : 0}%)`);
  ns.print(`------------------------------------------------------------`);
  ns.print(`ZIELSERVER-ZUSTAND (${data.target}):`);
  ns.print(`Sicherheit:      ${curSec.toFixed(2)} / ${minSec.toFixed(2)} (Min)`);
  ns.print(`Finanzen:        $${ns.format.number(curMoney)} / $${ns.format.number(maxMoney)} (${moneyPercent.toFixed(1)}%)`);
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