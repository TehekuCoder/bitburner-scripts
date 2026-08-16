import { NS } from "@ns";
import { DashboardData } from "/shared/types/batcher.js";

function makeProgressBar(progress: number, width = 20): string {
  const filledLength = Math.round(Math.max(0, Math.min(1, progress)) * width);
  const emptyLength = width - filledLength;
  return "█".repeat(filledLength) + "░".repeat(emptyLength);
}

export function drawBatcherDashboard(ns: NS, data: DashboardData): void {
  ns.clearLog();

  const ramUsed = data.ramTotal - data.ramFree;
  const ramPercent = data.ramTotal > 0 ? (ramUsed / data.ramTotal) * 100 : 0;
  const bar = makeProgressBar(data.progress, 20);

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
    `Wellen-RAM:  ${ns.format.ram(data.ramNeeded)} pro Set | Frei: ${ns.format.ram(data.ramFree)}`,
  );
  ns.print(`------------------------------------------------------------`);

  if (data.targetsSummary && data.targetsSummary.length > 1) {
    ns.print(`AKTIVE ZIELE (${data.targetsSummary.length}):`);
    ns.print(`ZIEL             MODE   BATCHES    MONEY      SEC`);

    for (const t of data.targetsSummary.slice(0, 8)) {
      const hasTarget = ns.serverExists(t.target);
      const curSec = hasTarget ? ns.getServerSecurityLevel(t.target) : 0;
      const minSec = hasTarget ? ns.getServerMinSecurityLevel(t.target) : 0;
      const curMoney = hasTarget ? ns.getServerMoneyAvailable(t.target) : 0;
      const maxMoney = hasTarget ? ns.getServerMaxMoney(t.target) : 0;

      const secDiff = curSec - minSec;
      const secStr = secDiff <= 0.05 ? "MIN" : `+${secDiff.toFixed(1)}`;
      const moneyPct =
        maxMoney > 0 ? ((curMoney / maxMoney) * 100).toFixed(0) + "%" : "0%";

      const namePadded = t.target.padEnd(16, " ").slice(0, 16);
      const modePadded = t.mode.padEnd(6, " ");
      const batchPadded = `${t.activeBatches}/${t.maxBatches}`.padEnd(11, " ");
      const moneyPadded = moneyPct.padEnd(10, " ");

      ns.print(
        `${namePadded} ${modePadded} ${batchPadded} ${moneyPadded} ${secStr}`,
      );
    }
  } else {
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

    ns.print(`ZIELSERVER-ZUSTAND (${statsTarget || "Keins"}):`);
    ns.print(`Sicherheit:  ${curSec.toFixed(2)} / ${minSec.toFixed(2)} (Min)`);
    ns.print(
      `Finanzen:    $${ns.format.number(curMoney)} / $${ns.format.number(maxMoney)} (${moneyPercent.toFixed(1)}%)`,
    );
  }

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