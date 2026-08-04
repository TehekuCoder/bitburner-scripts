import { NS } from "@ns";
import {
  PurchaseEvaluator,
  PurchaseRequest,
  PurchaseCategory,
  PurchasePriority,
} from "/lib/types/finance.js";
import { TRANSACTION_FEE } from "/lib/constants.js";
import { runEvaluator } from "/lib/evaluator-runner.js";

export const StockEvaluator: PurchaseEvaluator = {
  category: "STOCK_LICENSE",

  getRequests(ns: NS): PurchaseRequest[] {
    const requests: PurchaseRequest[] = [];
    if (!ns.stock) return requests;

    // --- 1. LIZENZEN VERWALTEN ---
    // Wichtig: Prioritäten auf LOW/IDLE setzen, damit teure Lizenzen NICHT das Home-RAM oder Hacknet blockieren!
    let fullyUnlocked = true;

    if (!ns.stock.hasWseAccount()) {
      fullyUnlocked = false;
      requests.push({
        id: "stock-wse-account",
        category: "STOCK_LICENSE" as PurchaseCategory,
        priority: PurchasePriority.LOW,
        cost: 200_000_000, // 200 Mio.
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
        priority: PurchasePriority.LOW,
        cost: 5_000_000_000, // 5 Mrd.
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
        priority: PurchasePriority.IDLE, // IDLE: Nur kaufen, wenn wirklich Geld über ist!
        cost: 1_000_000_000, // 1 Mrd.
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
        priority: PurchasePriority.IDLE, // 25 Mrd. NIEMALS auf HIGH setzen!
        cost: 25_000_000_000, // 25 Mrd.
        description: "4S TIX API (Forecast Automatisierung)",
        action: {
          script: "core/actions/act-stock.js",
          args: ["stock-purchase-license", "4s-tix"],
        },
      });
    }

    // Solange Lizenzen fehlen, keine Kauf-Anträge stellen
    if (!fullyUnlocked) return requests;

    // --- 2. TRADING LOGIK (Verkauf) ---
    const symbols = ns.stock.getSymbols();

    let canShort = true;
    try {
      ns.stock.buyShort(symbols[0], 0);
    } catch {
      canShort = false;
    }

    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const [shares, , sharesShort] = ns.stock.getPosition(sym);

      if (shares > 0 && forecast < 0.5) {
        ns.stock.sellStock(sym, shares);
      }

      if (canShort && sharesShort > 0 && forecast > 0.5) {
        ns.stock.sellShort(sym, sharesShort);
      }
    }

    // --- 3. TRADING LOGIK (Kauf-Anfragen) ---
    const buyCandidates: {
      sym: string;
      forecast: number;
      type: "LONG" | "SHORT";
      strength: number;
    }[] = [];

    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const [shares, , sharesShort] = ns.stock.getPosition(sym);

      if (shares === 0 && sharesShort === 0) {
        if (forecast > 0.6) {
          buyCandidates.push({
            sym,
            forecast,
            type: "LONG",
            strength: forecast - 0.5,
          });
        } else if (canShort && forecast < 0.4) {
          buyCandidates.push({
            sym,
            forecast,
            type: "SHORT",
            strength: 0.5 - forecast,
          });
        }
      }
    }

    buyCandidates.sort((a, b) => b.strength - a.strength);

    // Barmittel sinnvoll portionieren (max. 20% des verfügbaren Geldes pro Investment)
    const playerMoney = ns.getServerMoneyAvailable("home");
    const tradeBudget = playerMoney * 0.2;

    // Nur investieren, wenn das Budget mindestens 10x höher als die Transaktionsgebühr ist
    if (tradeBudget > TRANSACTION_FEE * 10) {
      for (const candidate of buyCandidates.slice(0, 2)) {
        const sym = candidate.sym;
        const maxShares = ns.stock.getMaxShares(sym);
        const sharePrice =
          candidate.type === "LONG"
            ? ns.stock.getAskPrice(sym)
            : ns.stock.getBidPrice(sym);

        // Berechne wie viele Aktien wir uns mit dem Budget leisten können
        const affordableShares = Math.min(
          maxShares,
          Math.floor((tradeBudget - TRANSACTION_FEE) / sharePrice)
        );

        if (affordableShares > 0) {
          const targetCost = affordableShares * sharePrice + TRANSACTION_FEE;

          requests.push({
            id: `stock-invest-${sym}-${candidate.type}`,
            category: "STOCK_TRADE" as PurchaseCategory,
            priority: PurchasePriority.IDLE,
            cost: targetCost,
            description: `Aktien-Kauf: ${sym} (${candidate.type})`,
            action: {
              script: "core/actions/act-stock.js",
              args: ["stock-buy", sym, candidate.type, affordableShares],
            },
          });
        }
      }
    }

    return requests;
  },
};

export async function main(ns: NS): Promise<void> {
  await runEvaluator(ns, StockEvaluator);
}