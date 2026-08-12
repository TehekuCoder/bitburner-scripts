import { NS, BitNodeMultipliers } from "@ns";
import { DEFAULT_MULTIPLIERS } from "/lib/constants.js";
import { PurchasePriority } from "./types/finance";
import { BitNodeInfo } from "./types/common";

// ============================================================================
// 1. BitNode & System Helpers
// ============================================================================

/**
 * Ermittelt den exakten BitNode inklusive des aktuellen Levels/Stufe.
 * 
 * @example
 * const bn = getExactBitNode(ns);
 * if (bn.node === 2) { ... } // BitNode 2 (egal welches Level)
 * if (bn.formatted === "9.2") { ... } // Speziell BN 9.2
 */
export function getExactBitNode(ns: NS): BitNodeInfo {
  const resetInfo = ns.getResetInfo();
  const node = resetInfo.currentNode;
  const ownedSFLevel = resetInfo.ownedSF.get(node) ?? 0;
  const level = ownedSFLevel + 1;

  return {
    node,
    level,
    formatted: `${node}.${level}`,
  };
}



/**
 * Lädt BitNode-Multiplikatoren aus der bn-multipliers.txt auf 'home'.
 * Fällt auf DEFAULT_MULTIPLIERS zurück, falls die Datei fehlt oder ungültig ist.
 */
export function loadBnMults(ns: NS): Record<keyof BitNodeMultipliers, number> {
  if (ns.fileExists("bn-multipliers.txt", "home")) {
    try {
      const fileContent = ns.read("bn-multipliers.txt");
      if (fileContent) {
        return { ...DEFAULT_MULTIPLIERS, ...JSON.parse(fileContent) };
      }
    } catch {
      ns.print("⚠️ [LIB] Fehler beim Parsen der bn-multipliers.txt. Nutze Fallback.");
    }
  }
  return DEFAULT_MULTIPLIERS;
}

/**
 * Extrahiert den reinen Skriptnamen ohne Ordnerpfad.
 * Beispiel: "/daemons/batcher-daemon.js" -> "batcher-daemon.js"
 */
export function getScriptNameOnly(scriptPath: string): string {
  return scriptPath.split("/").pop() || scriptPath;
}

// ============================================================================
// 2. Formatting Helpers (Geld, RAM, Zeit)
// ============================================================================

/**
 * Formatiert Geldbeträge in ein kompaktes, lesbares Format (z.B. $1.23m, $45.67b).
 */
export function formatMoney(amount: number): string {
  if (isNaN(amount) || amount === 0) return "$0.00";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";

  const units = ["", "k", "m", "b", "t", "q", "Q", "s", "S", "o", "n"];
  const i = Math.floor(Math.log10(abs) / 3);

  if (i <= 0) return `${sign}$${abs.toFixed(2)}`;
  const scaled = abs / Math.pow(10, i * 3);
  const unit = units[i] ?? `e${i * 3}`;

  return `${sign}$${scaled.toFixed(2)}${unit}`;
}

/**
 * Formatiert RAM-Angaben dynamisch (z.B. 16 -> "16 GB", 2048 -> "2.00 TB").
 */
export function formatRam(gb: number): string {
  if (gb >= 1024 * 1024) return `${(gb / (1024 * 1024)).toFixed(2)} PB`;
  if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`;
  return `${gb.toFixed(0)} GB`;
}

/**
 * Formatiert Millisekunden in ein Verbleibende-Zeit-Format (z.B. "02:15" oder "01:12:45").
 */
export function formatTime(ms: number): string {
  if (ms <= 0 || isNaN(ms)) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

// ============================================================================
// 3. Math & Logic Helpers
// ============================================================================

/**
 * Begrenzt einen Zahlwert strikt auf das Intervall [min, max].
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

/**
 * Rundet eine Zahl auf eine bestimmte Anzahl von Nachkommastellen.
 */
export function roundTo(val: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

/**
 * Berechnet den prozentualen Fortschritt zwischen 0 und 1 (für UI-Fortschrittsbalken).
 */
export function getProgressRatio(current: number, target: number): number {
  if (target <= 0) return 1;
  return clamp(current / target, 0, 1);
}

/**
 * Prüft sauber, ob die Singularity-API (SF4 / BN4) verfügbar ist.
 * 
 * @param ns Bitburner Netscript Context
 * @returns true, wenn Singularity-Funktionen genutzt werden können.
 */
export function hasSingularity(ns: NS): boolean {
  return ns.singularity !== undefined;
}
/**
 * Prüft sauber, ob die Gang-API (SF2 / BN2) verfügbar ist.
 * 
 * @param ns Bitburner Netscript Context
 * @returns true, wenn Gang-Funktionen genutzt werden können.
 */
export function hasGang(ns: NS): boolean {
  return ns.gang !== undefined;
}
/**
 * Prüft sauber, ob die Sleeve-API (SF10 / BN10) verfügbar ist.
 * 
 * @param ns Bitburner Netscript Context
 * @returns true, wenn Sleeve-Funktionen genutzt werden können.
 */
export function hasSleeve(ns: NS): boolean {
  return ns.sleeve !== undefined;
}
/**
 * Prüft sauber, ob die Sleeve-API (SF3 / BN3) verfügbar ist.
 * 
 * @param ns Bitburner Netscript Context
 * @returns true, wenn Corporation-Funktionen genutzt werden können.
 */
export function hasCorporation(ns: NS): boolean {
  return ns.corporation !== undefined;
}
/**
 * Prüft sauber, ob die Bladeburner-API (SF6/7 / BN6/7) verfügbar ist.
 * 
 * @param ns Bitburner Netscript Context
 * @returns true, wenn Bladburner-Funktionen genutzt werden können.
 */
export function hasBladeburner(ns: NS): boolean {
  return ns.bladeburner !== undefined;
}

export function adjustPriorityByMult(
  basePriority: PurchasePriority,
  mult: number
): PurchasePriority {
  if (mult <= 0) return PurchasePriority.IDLE;
  if (mult < 0.1) return Math.min(PurchasePriority.IDLE, basePriority + 2); // Stark ge-nerft (z.B. 2 Stufen schlechter)
  if (mult < 0.5) return Math.min(PurchasePriority.IDLE, basePriority + 1); // Moderat ge-nerft
  if (mult >= 2.0 && basePriority > PurchasePriority.CRITICAL) {
    return Math.max(PurchasePriority.CRITICAL, basePriority - 1); // Gebufft -> Dringlicher
  }
  return basePriority;
}

// ============================================================================
// 4. Process & Service Helpers
// ============================================================================

export interface EnsureDaemonOptions {
  host?: string;
  threads?: number;
  args?: (string | number | boolean)[];
  /** Optionale Bedingung (z.B. hasSleeve(ns)), die true sein muss */
  condition?: () => boolean;
  /** Optionaler Logger zur Protokollierung */
  logger?: { info: (msg: string) => void; warn?: (msg: string) => void };
}

/**
 * Stellt sicher, dass ein Hintergrund-Daemon/Service dauerhaft läuft.
 * Prüft automatisch API-Verfügbarkeit, Dateiexistenz, Laufzeitstatus und RAM.
 * 
 * @returns true, wenn das Skript bereits läuft oder erfolgreich gestartet wurde.
 */
export function ensureDaemon(
  ns: NS,
  scriptPath: string,
  options: EnsureDaemonOptions = {}
): boolean {
  const { host = "home", threads = 1, args = [], condition, logger } = options;

  // 1. Pre-Check (z.B. API noch nicht freigeschaltet)
  if (condition && !condition()) {
    return false;
  }

  // 2. Existenz & Status prüfen
  if (!ns.fileExists(scriptPath, host)) {
    return false;
  }
  if (ns.isRunning(scriptPath, host, ...args)) {
    return true;
  }

  // 3. RAM-Check
  const freeRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
  const requiredRam = ns.getScriptRam(scriptPath, host) * threads;

  if (freeRam < requiredRam) {
    logger?.warn?.(
      `⚠️ Zu wenig RAM für ${getScriptNameOnly(scriptPath)} auf ${host} ` +
      `(Frei: ${formatRam(freeRam)}, Benötigt: ${formatRam(requiredRam)})`
    );
    return false;
  }

  // 4. Starten
  const pid = ns.exec(scriptPath, host, threads, ...args);
  if (pid > 0) {
    logger?.info(`🚀 Service gestartet: ${scriptPath} (PID: ${pid})`);
    return true;
  }

  return false;
}