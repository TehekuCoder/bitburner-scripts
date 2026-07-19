import { NS } from "@ns";
import { BotState } from "/core/types";


/**
 * Erstellt einen visuelle Ladebalken.
 * Robust gegen Division durch Null und negative Werte.
 */
export function createProgressBar(current: number, target: number, size = 10): string {
  if (target <= 0) return `[██████████] 100.0%`;
  
  // BEHOBEN: Math.max(0, ...) verhindert negative Werte und damit RangeErrors beim .repeat()
  const percent = Math.max(0, Math.min(1, current / target));
  const progress = Math.floor(size * percent);
  const bar = "█".repeat(progress) + "░".repeat(size - progress);
  
  return `[${bar}] ${(percent * 100).toFixed(1)}%`;
}

/**
 * NEU: Nimmt einen Systemstatus und formatiert ihn als elegante UI-Card
 * für ns.ui.openTail() oder das Terminal.
 */
export function renderStatusCard(ns: NS, state: BotState): string {
  const width = 42;
  const separator = "=".repeat(width);
  const thinLine = "-".repeat(width);

  let output = `${separator}\n`;
  output += ` ${"🧠 BitOS CENTRAL NERVOUS SYSTEM".padEnd(width - 1)}\n`;
  output += `${separator}\n`;
  
  // Strategie & Status
  output += ` STRATEGY : ${state.strategy.padEnd(width - 13)}\n`;
  
  if (state.targetFaction) {
    output += ` FACTION  : ${state.targetFaction.padEnd(width - 13)}\n`;
  } else if (state.targetCompany) {
    output += ` COMPANY  : ${state.targetCompany.padEnd(width - 13)}\n`;
  }
  
  output += `${thinLine}\n`;
  
  // Progressbar zentrieren
  const barLabel = `PROGRESS: ${state.progressBar}`;
  output += ` ${barLabel.padEnd(width - 2)} \n`;
  
  // Zeitstempel für den "Herzschlag" des Systems
  const ageSeconds = Math.floor((Date.now() - state.lastUpdate) / 1000);
  const heartbeat = ageSeconds < 3 ? "💚 ACTIVE" : `⏳ STALE (${ageSeconds}s)`;
  output += `${thinLine}\n`;
  output += ` HACK LVL : ${ns.format.number(ns.getHackingLevel(), 0).padEnd(width - 13)}\n`;
  output += ` KERNEL   : ${heartbeat.padEnd(width - 13)}\n`;
  
  output += `${separator}`;
  
  return output;
}