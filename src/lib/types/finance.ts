import { NS } from "@ns";

/**
 * Kategorien zur Steuerung von Prioritäten und Budget-Limits
 */
export type PurchaseCategory =
  | "HOME_SERVER"
  | "PURCHASED_SERVER"
  | "DARKNET_PROGRAM"
  | "PLAYER_AUG"
  | "SLEEVE_AUG"
  | "GANG_EQUIPMENT"
  | "HACKNET"
  | "CORP"
  | "STOCK_LICENSE" // Neue Kategorie für API Zugänge
  | "STOCK_TRADE";

/**
 * Prioritäts-Stufen für Kaufanfragen.
 * Kleinere Werte sind dringender und werden zuerst berücksichtigt.
 *
 * CRITICAL: Sofortiger Bedarf, der den Fortschritt blockiert oder die
 *           Grundlage für weitere Aktionen schafft (z. B. TOR, erste Programme).
 * HIGH:     Wichtige Verbesserungen, die den Spielverlauf deutlich beschleunigen.
 * MEDIUM:   Sinnvolle Upgrades, die aber nicht sofort zwingend sind.
 * LOW:      Opportunistische oder eher kosmetische Verbesserungen.
 * IDLE:     Nur ausführen, wenn deutlich mehr Geld verfügbar ist als für
 *           die wichtigen Prioritäten nötig wäre.
 */
export enum PurchasePriority {
  CRITICAL = 1,
  HIGH = 2,
  MEDIUM = 3,
  LOW = 4,
  IDLE = 5,
}

/**
 * Struktur einer einzelnen Kaufanfrage
 */
export interface PurchaseRequest {
  /** Eindeutige ID zur Vermeidung von Mehrfachkäufen (z.B. "home-ram-128gb") */
  id: string;

  /** Kategorie für globale Budget-Regeln */
  category: PurchaseCategory;

  /** Basis-Priorität */
  priority: PurchasePriority;

  /** Exakte Kosten in Dollar */
  cost: number;

  /** Lesbare Beschreibung für Logging & Dashboard-UI */
  description: string;

  /**
   * Optionaler ROI / Effizienz-Factor (z.B. ROI in $/sec pro investiertem Dollar).
   * Dient als Tie-Breaker bei gleicher Prioritätsstufe.
   */
  score?: number;

  action: {
    script: string;
    args: (string | number)[];
  };
}

/**
 * Standard-Interface für Sub-System-Evaluatoren
 */
export interface PurchaseEvaluator {
  category: PurchaseCategory;
  /**
   * Analysiert den Spielzustand und liefert alle aktuell sinnvollen Kaufanfragen.
   */
  getRequests(ns: NS): PurchaseRequest[];
}
