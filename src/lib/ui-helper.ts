import { NS, FactionName } from "@ns";
import { BotStrategy } from "../core/state-manager.js";

export interface UIProgressBarParams {
  mode: BotStrategy;
  label: string;
  currentVal: number;
  targetVal: number;
  etaStr: string;
  targetFaction: FactionName | null;
  playerMoney: number;
  effectiveThreshold: number;
  cachedFallbackTarget: string;
  hasFormulas: boolean;
  canRunBatcher: boolean;
  factionToWorkFor: { name: FactionName } | null;
  isReadyForFactionGrind: boolean;
  crimeMoneyMult: number;
  currentState: any;
}

/**
 * Generiert den formatierten Statusbalken (Progress Bar) für das Dashboard.
 */
export function generateProgressBar(ns: NS, params: UIProgressBarParams): string {
  const {
    mode,
    label,
    currentVal,
    targetVal,
    etaStr,
    targetFaction,
    playerMoney,
    effectiveThreshold,
    cachedFallbackTarget,
    hasFormulas,
    canRunBatcher,
    factionToWorkFor,
    isReadyForFactionGrind,
    crimeMoneyMult,
    currentState,
  } = params;

  let generatedBar = "";

  // --- STRATEGIE-SPEZIFISCHE UI-GENERIERUNG ---
  if (["REP", "CORP", "TRAIN"].includes(mode) && targetVal > 0) {
    const pct = ((currentVal / targetVal) * 100).toFixed(1);
    generatedBar = `${label} | ${ns.format.number(currentVal, 1)}/${ns.format.number(targetVal, 1)} (${pct}%) | ETA: ${etaStr}`;
  } 
  
  else if (targetVal === 0 && mode === "REP" && targetFaction) {
    generatedBar = `🥷 ${targetFaction} | Karma/Gang Grind aktiv`;
  } 
  
  else if (mode === "XP_SPRINT") {
    generatedBar = "👶 Early Game: XP SPRINT (Hacking < 50)";
  } 
  
  else if (mode === "CRIME") {
    generatedBar =
      crimeMoneyMult > 5
        ? "🥷 BN-Synergie: Dauerhafter Crime Loop aktiv (Mörderischer Profit)"
        : "🥷 Mid-Game-Crime Loop für stabiles Einkommen";
  } 
  
  else if (mode === "PSERV_RUSH") {
    const pservCost = ns.cloud.getServerCost(64);
    const rushProgress = ((playerMoney / pservCost) * 100).toFixed(1);
    generatedBar = canRunBatcher
      ? `🚀 BATCHER AKTIV (Netzwerk) | Cash: ${ns.format.number(playerMoney, 1)} / ${ns.format.number(pservCost, 0)} $ (${rushProgress}%)`
      : `🚀 BATCHER RUSH aktiv | Cash: ${ns.format.number(playerMoney, 1)} / ${ns.format.number(pservCost, 0)} $ (${rushProgress}%) | Warte auf Infrastruktur`;
  } 
  
  else if (mode === "KILLS") {
    generatedBar = `💀 Eliminierungs-Aufträge active (${currentVal}/${targetVal} Kills)`;
  } 
  
  else if (mode === "MONEY" && !canRunBatcher) {
    if (!hasFormulas) {
      generatedBar = `🏗️ Aufbau-Phase: Generiere Geld auf ${cachedFallbackTarget} (Warte auf Formulas.exe)`;
    } else {
      generatedBar = `🏗️ Aufbau-Phase: Generiere Geld auf ${cachedFallbackTarget} (Warte auf Server mit 32GB+ RAM)`;
    }
  } 
  
  else {
    if (factionToWorkFor) {
      if (isReadyForFactionGrind) {
        generatedBar = `⏳ Bereit für ${factionToWorkFor.name} | Warte auf Beitritt/Einladung`;
      } else {
        const progressPct = ((playerMoney / effectiveThreshold) * 100).toFixed(1);
        generatedBar = `💰 Spare für ${factionToWorkFor.name}: ${ns.format.number(playerMoney, 1)} / ${ns.format.number(effectiveThreshold, 0)} $ (${progressPct}%)`;
      }
    } else {
      generatedBar = "💰 Maximiere Profit (Batcher)";
    }
  }

  // --- SPEZIALFALL: AKTIVER CRIME-WORKER ÜBERSCHREIBT STATUS ---
  let finalBar = generatedBar;
  if (
    (mode === "CRIME" || mode === "XP_SPRINT") &&
    ns.isRunning("/tasks/crime.js", "home")
  ) {
    if (currentState?.progressBar?.startsWith("🥷")) {
      finalBar = currentState.progressBar;
    }
  }

  return finalBar;
}