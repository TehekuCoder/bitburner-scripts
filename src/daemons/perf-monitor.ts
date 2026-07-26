import { NS } from "@ns";
import { LoggerClient } from "lib/logger-client";

// ANSI Farb-Codes für Terminal-Styling
const COLORS = {
  reset: "\u001b[0m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
  bold: "\u001b[1m",
};

// ASCII Stufen für den Chart
const SPARK_CHARS = [" ", " ", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail(); // Öffnet das dedizierte UI-Fenster

  const logger = new LoggerClient(ns, "PERF-MONITOR");

  const TARGET_INTERVAL = 100;
  const LAG_THRESHOLD = 50;
  const WARN_COOLDOWN = 3000;

  let maxLag = 0;
  let totalLag = 0;
  let samples = 0;
  let lastWarnTime = 0;

  // Historie für den Sparkline-Graph (letzte 20 Messungen)
  const historySize = 20;
  const lagHistory: number[] = new Array(historySize).fill(0);

  logger.info("⚡ Performance-Wächter mit Dashboard gestartet.");

  while (true) {
    const start = performance.now();
    await ns.sleep(TARGET_INTERVAL);

    const actualElapsed = performance.now() - start;
    const lag = Math.max(0, actualElapsed - TARGET_INTERVAL);

    samples++;
    totalLag += lag;
    if (lag > maxLag) maxLag = lag;

    // Historie aktualisieren (FIFO)
    lagHistory.shift();
    lagHistory.push(lag);

    const now = Date.now();

    // 🚨 Stiller Alarm an sys-logger senden, wenn Spike auftritt
    if (lag > LAG_THRESHOLD && now - lastWarnTime > WARN_COOLDOWN) {
      logger.warn(
        `🚨 Event-Loop Spike! Lag: +${lag.toFixed(1)}ms (Gemessen: ${actualElapsed.toFixed(1)}ms)`
      );
      lastWarnTime = now;
    }

    // 📊 DASHBOARD REDRAW (Jeden Tick für flüssige Optik)
    const avgLag = totalLag / samples;
    renderDashboard(ns, lag, avgLag, maxLag, lagHistory);

    // Statistik-Reset alle ~10 Sekunden (100 Samples)
    if (samples >= 100) {
      maxLag = 0;
      totalLag = 0;
      samples = 0;
    }
  }
}

/**
 * Zeichnet das schematische Terminal-Dashboard
 */
function renderDashboard(
  ns: NS,
  currentLag: number,
  avgLag: number,
  maxLag: number,
  history: number[]
): void {
  ns.clearLog();

  // Status-Auswertung
  let statusColor = COLORS.green;
  let statusText = "NOMINAL";
  if (currentLag > 50) {
    statusColor = COLORS.red;
    statusText = "CRITICAL SPIKE";
  } else if (currentLag > 20) {
    statusColor = COLORS.yellow;
    statusText = "ELEVATED LAG";
  }

  // Sparkline Chart generieren
  const maxInHistory = Math.max(...history, 10); // Mindestens Scale bis 10ms
  const sparkline = history
    .map((val) => {
      const idx = Math.min(
        SPARK_CHARS.length - 1,
        Math.floor((val / maxInHistory) * SPARK_CHARS.length)
      );
      const color = val > 50 ? COLORS.red : val > 15 ? COLORS.yellow : COLORS.green;
      return `${color}${SPARK_CHARS[idx]}${COLORS.reset}`;
    })
    .join("");

  // Health-Bar (0-100ms Relativskala)
  const barLength = 20;
  const filled = Math.min(barLength, Math.round((currentLag / 100) * barLength));
  const healthBar =
    `${statusColor}` +
    "█".repeat(filled) +
    `${COLORS.gray}` +
    "░".repeat(barLength - filled) +
    `${COLORS.reset}`;

  // UI Rendern
  ns.print(`┌─────────────────────────────────────────┐`);
  ns.print(
    `│ ${COLORS.bold}${COLORS.cyan}SYSTEM PERFORMANCE MONITOR${COLORS.reset}   [${statusColor}${statusText.padEnd(12)}${COLORS.reset}] │`
  );
  ns.print(`├─────────────────────────────────────────┤`);
  ns.print(
    `│  Current Lag : ${formatMs(currentLag)} ${healthBar} │`
  );
  ns.print(
    `│  Average Lag : ${formatMs(avgLag)}                      │`
  );
  ns.print(
    `│  Peak Spike  : ${formatMs(maxLag)}                      │`
  );
  ns.print(`├─────────────────────────────────────────┤`);
  ns.print(`│  Live History (20 Ticks):                │`);
  ns.print(`│  [${sparkline}]             │`);
  ns.print(`└─────────────────────────────────────────┘`);
}

function formatMs(ms: number): string {
  const formatted = `+${ms.toFixed(1)}ms`.padStart(8);
  if (ms > 50) return `${COLORS.red}${formatted}${COLORS.reset}`;
  if (ms > 15) return `${COLORS.yellow}${formatted}${COLORS.reset}`;
  return `${COLORS.green}${formatted}${COLORS.reset}`;
}