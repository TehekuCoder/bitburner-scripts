import { NS } from "@ns";
import { DashboardData } from "/lib/types/common";

function makeProgressBar(progress: number, width = 20): string {
  const filledLength = Math.round(Math.max(0, Math.min(1, progress)) * width);
  const emptyLength = width - filledLength;
  return "█".repeat(filledLength) + "░".repeat(emptyLength);
}

export function drawBatcherDashboard(ns: NS, data: DashboardData): void {
  ns.clearLog();

  // 🟢 FIX: Prüfe mit ns.serverExists, ob das Ziel ein echter Servername ist.
  // Falls data.target ein kombinierter String ist, versuche das erste Target aus targetsSummary zu nutzen.
  let statsTarget = "";
  if (ns.serverExists(data.target)) {
    statsTarget = data.target;
  } else if (
    data.targetsSummary &&
    data.targetsSummary.length > 0 &&
    ns.serverExists(data.targetsSummary[0].target)
  ) {
    statsTarget = data.targetsSummary[0].target;
  }

  const hasValidTarget = statsTarget !== "";

  const curSec = hasValidTarget ? ns.getServerSecurityLevel(statsTarget) : 0;
  const minSec = hasValidTarget ? ns.getServerMinSecurityLevel(statsTarget) : 0;
  const curMoney = hasValidTarget ? ns.getServerMoneyAvailable(statsTarget) : 0;
  const maxMoney = hasValidTarget ? ns.getServerMaxMoney(statsTarget) : 0;

  const moneyPercent = maxMoney > 0 ? (curMoney / maxMoney) * 100 : 0;
  const ramUsed = data.ramTotal - data.ramFree;
  const ramPercent = data.ramTotal > 0 ? (ramUsed / data.ramTotal) * 100 : 0;
  const bar = makeProgressBar(data.progress, 20);

  const targetHeader =
    data.targetsSummary && data.targetsSummary.length > 1
      ? `ZIELSERVER-ZUSTAND (${statsTarget}):`
      : `ZIELSERVER-ZUSTAND:`;

  ns.print(`============================================================`);
  ns.print(
    `⚡ BIT-OS DYNAMIC BATCHER v2.2     |  Gewinn/Welle: +$${ns.format.number(data.lastWaveProfit)}`,
  );
  ns.print(`============================================================`);
  ns.print(`FOKUS-ZIEL:      ${data.target}`);
  ns.print(`STATUS:          [${bar}] ${data.status}`);
  ns.print(`DETAILS:         ${data.progressText}`);
  ns.print(`------------------------------------------------------------`);
  ns.print(`NETZWERK-ALLOKATION:`);
  ns.print(
    `RAM Pool:    ${ns.format.ram(ramUsed)} / ${ns.format.ram(data.ramTotal)} (${ramPercent.toFixed(1)}%)`,
  );
  ns.print(
    `Wellen-Ram:  ${ns.format.ram(data.ramNeeded)} Benötigt | Frei gepoolt: ${ns.format.ram(data.ramFree)}`,
  );
  ns.print(`------------------------------------------------------------`);
  ns.print(targetHeader);
  ns.print(`Sicherheit:  ${curSec.toFixed(2)} / ${minSec.toFixed(2)} (Min)`);
  ns.print(
    `Finanzen:    $${ns.format.number(curMoney)} / $${ns.format.number(maxMoney)} (${moneyPercent.toFixed(1)}%)`,
  );
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