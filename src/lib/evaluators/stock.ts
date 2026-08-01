import { NS } from "@ns";
import { PurchaseEvaluator, PurchaseRequest, PurchaseCategory, PurchasePriority } from "/lib/types/finance.js";
import { TRANSACTION_FEE } from "/lib/constants.js";
import { runEvaluator } from "/lib/evaluator-runner.js";

// Füge STOCK_LICENSE und STOCK_TRADE zu deiner PurchaseCategory in finance.ts hinzu!

export const StockEvaluator: PurchaseEvaluator = {
  category: "STOCK_LICENSE", // Hauptkategorie

  getRequests(ns: NS): PurchaseRequest[] {
    const requests: PurchaseRequest[] = [];
    if (!ns.stock) return requests;

    // --- 1. LIZENZEN VERWALTEN ---
    let fullyUnlocked = true;

    if (!ns.stock.hasWseAccount()) {
      fullyUnlocked = false;
      requests.push({
        id: "stock-wse-account",
        category: "STOCK_LICENSE" as PurchaseCategory,
        priority: PurchasePriority.MEDIUM, 
        cost: 200_000_000, // WSE Account Preis
        description: "Börsenzugang (WSE)",
        action: {
          script: "core/actions/act-stock.js",
          args: ["stock-purchase-license", "wse"],
        },
      });
    } else if (!ns.stock.hasTixApiAccess()) {
      fullyUnlocked = false;
      requests.push({
        id: "stock-tix-api",
        category: "STOCK_LICENSE" as PurchaseCategory,
        priority: PurchasePriority.MEDIUM,
        cost: 5_000_000_000, // 5 Milliarden
        description: "TIX API (Börsen-Automatisierung)",
        action: {
          script: "core/actions/act-stock.js",
          args: ["stock-purchase-license", "tix"],
        },
      });
    } else if (!ns.stock.has4SData()) {
      fullyUnlocked = false;
      requests.push({
        id: "stock-4s-data",
        category: "STOCK_LICENSE" as PurchaseCategory,
        priority: PurchasePriority.HIGH, // Sehr wichtig für Trading!
        cost: 1_000_000_000, // 1 Milliarde
        description: "4S Marktdaten (Forecast)",
        action: {
          script: "core/actions/act-stock.js",
          args: ["stock-purchase-license", "4s"],
        },
      });
    } else if (!ns.stock.has4SDataTixApi()) {
      fullyUnlocked = false;
      requests.push({
        id: "stock-4s-tix-api",
        category: "STOCK_LICENSE" as PurchaseCategory,
        priority: PurchasePriority.HIGH,
        cost: 25_000_000_000, // 25 Milliarden
        description: "4S TIX API (Forecast Automatisierung)",
        action: {
          script: "core/actions/act-stock.js",
          args: ["stock-purchase-license", "4s-tix"],
        },
      });
    }

    // Wenn Lizenzen fehlen, dürfen wir ohnehin noch nicht traden.
    if (!fullyUnlocked) return requests;

    // --- 2. TRADING LOGIK (Automatischer Verkauf) ---
    // Der Evaluator kümmert sich selbst um das Abstoßen schlechter Aktien.
    // Das kostet kein Geld (es generiert welches), also machen wir das sofort hier bei der Evaluierung.
    const symbols = ns.stock.getSymbols();
    
    // Anmerkung: canShort muss dynamisch geprüft werden, falls BN8 nicht aktiv ist.
    let canShort = true;
    try { ns.stock.buyShort(symbols[0], 0); } catch { canShort = false; }

    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const [shares, avgPrice, sharesShort, avgPriceShort] = ns.stock.getPosition(sym);

      // Schlechte LONG-Positionen verkaufen
      if (shares > 0 && forecast < 0.5) {
        ns.stock.sellStock(sym, shares);
      }
      
      // Schlechte SHORT-Positionen decken
      if (canShort && sharesShort > 0 && forecast > 0.5) {
        ns.stock.sellShort(sym, sharesShort);
      }
    }

    // --- 3. TRADING LOGIK (Kauf-Anfragen generieren) ---
    const buyCandidates: { sym: string; forecast: number; type: "LONG" | "SHORT"; strength: number }[] = [];
    
    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const [shares, , sharesShort] = ns.stock.getPosition(sym);

      // Nur investieren, wenn wir nicht schon in der Aktie stecken
      if (shares === 0 && sharesShort === 0) {
        if (forecast > 0.6) {
          buyCandidates.push({ sym, forecast, type: "LONG", strength: forecast - 0.5 });
        } else if (canShort && forecast < 0.4) {
          buyCandidates.push({ sym, forecast, type: "SHORT", strength: 0.5 - forecast });
        }
      }
    }

    buyCandidates.sort((a, b) => b.strength - a.strength);

    // Wir beantragen Investitionen beim Finance-Core.
    // Aber NUR mit Priorität IDLE (nur machen, wenn nichts anderes ansteht).
    for (const candidate of buyCandidates) {
      const sym = candidate.sym;
      const maxShares = ns.stock.getMaxShares(sym);
      const sharePrice = candidate.type === "LONG" ? ns.stock.getAskPrice(sym) : ns.stock.getBidPrice(sym);
      const targetCost = (maxShares * sharePrice) + TRANSACTION_FEE;

      requests.push({
        id: `stock-invest-${sym}-${candidate.type}`,
        category: "STOCK_TRADE" as PurchaseCategory,
        priority: PurchasePriority.IDLE, // <- WICHTIG! Investieren nur wenn Geld rumliegt
        cost: targetCost, // Der Core muss uns diese Summe freigeben
        description: `Aktien-Kauf: ${sym} (${candidate.type})`,
        action: {
          script: "core/actions/act-stock.js",
          args: ["stock-buy", sym, candidate.type],
        },
      });
    }

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, StockEvaluator);
}
