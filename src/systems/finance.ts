import { NS } from "@ns";
import { loadState, patchState } from "../core/state-manager.js";
import { Logger } from "../core/logger.js";

// --- GLOBALE KONSTANTEN ---
const TRANSACTION_FEE = 100_000;
const MIN_INVESTMENT = 5_000_000;
const CASH_BUFFER = 2_000_000; // Eiserne Reserve für Trading-Gebühren

// 🛡️ DYNAMISCHE RESERVE-BERECHNUNG
// Berechnet, wie viel Geld für essenzielle Meilensteine gesichert werden muss
function getDynamicReserve(ns: NS): { reserve: number; financeProgress: string } {
  const currentMoney = ns.getServerMoneyAvailable("home");
  
  // FIX: Prüft die Existenz des darkweb-Servers statt des nicht existenten Player-Attributs
  const hasTor = ns.serverExists("darkweb"); 
  
  let targetReserve = 0;
  let targetName = "";

  if (!hasTor) {
    targetReserve = 200_000;
    targetName = "TOR Router";
  } else if (!ns.fileExists("BruteSSH.exe", "home")) {
    targetReserve = 500_000;
    targetName = "BruteSSH";
  } else if (!ns.fileExists("FTPCrack.exe", "home")) {
    targetReserve = 1_500_000;
    targetName = "FTPCrack";
  } else if (!ns.fileExists("relaySMTP.exe", "home")) {
    targetReserve = 5_000_000;
    targetName = "relaySMTP";
  } else if (!ns.fileExists("HTTPWorm.exe", "home")) {
    targetReserve = 30_000_000;
    targetName = "HTTPWorm";
  } else if (!ns.fileExists("SQLInject.exe", "home")) {
    targetReserve = 250_000_000;
    targetName = "SQLInject";
  } else if (!ns.fileExists("Formulas.exe", "home")) {
    targetReserve = 5_000_000_000;
    targetName = "Formulas.exe";
  }

  let reserve = 0;
  let financeProgress = "";

  if (targetReserve > 0) {
    // Wenn wir mehr als 50% des Ziels haben, frieren wir den Betrag ein
    if (currentMoney >= targetReserve * 0.5) {
      reserve = targetReserve;
      financeProgress = `Sichere $${ns.format.number(reserve, 0)} (${targetName})`;
    } else {
      // Sonst sparen wir weich mit 10% unseres aktuellen Budgets an
      reserve = currentMoney * 0.1;
      financeProgress = `Aufbau f. ${targetName}`;
    }
  } else {
    // Alle Pflichtkäufe erledigt: 5% des Kapitals als liquide Reserve halten
    reserve = Math.max(CASH_BUFFER, currentMoney * 0.05);
    financeProgress = `Aktiv | Res: $${ns.format.number(reserve, 1)}`;
  }

  // FIX: Rückgabe-Eigenschaften stimmen nun exakt mit dem Typ überein
  return { reserve, financeProgress };
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  
  const logger = new Logger(ns, "FINANCE", "INFO", "/logs/finance.txt");
  logger.info("⚡ Finanz- & Reserve-Subsystem v4.1 [TYPED] aktiv.");

  let fullyUnlocked = false;
  let canShort = true; 
  let lastLogTime = 0;

  // Cleanup-Handler für sauberen Exit
  ns.atExit(() => {
    patchState(ns, {
      traderMode: "INACTIVE",
      traderProgress: "Inaktiv",
      financeProgress: "Inaktiv"
    });
    logger.info("Finanz-Manager sauber beendet.");
  });

  while (true) {
    // --- 0. BUDGET- & RESERVE-UPDATE ---
    const { reserve, financeProgress } = getDynamicReserve(ns);

    // --- 1. LIZENZ-VERWALTUNG & CAPABILITY-PROBE ---
    if (!fullyUnlocked) {
      let unlocked = true;
      let missingLicense = "";

      if (!ns.stock.hasWseAccount()) {
        missingLicense = "WSE Account ($100m)";
        if (ns.stock.purchaseWseAccount()) {
          logger.success("WSE Konto erworben.");
        } else {
          unlocked = false;
        }
      }
      if (unlocked && !ns.stock.hasTixApiAccess()) {
        missingLicense = "TIX API ($5b)";
        if (ns.stock.purchaseTixApi()) {
          logger.success("TIX API freigeschaltet.");
        } else {
          unlocked = false;
        }
      }
      if (unlocked && !ns.stock.has4SData()) {
        missingLicense = "4S Marktdaten ($1b)";
        if (ns.stock.purchase4SMarketData()) {
          logger.success("4S Marktdaten aktiv.");
        } else {
          unlocked = false;
        }
      }
      if (unlocked && !ns.stock.has4SDataTixApi()) {
        missingLicense = "4S TIX API ($25b)";
        if (ns.stock.purchase4SMarketDataTixApi()) {
          logger.success("4S TIX API voll lizenziert.");
        } else {
          unlocked = false;
        }
      }

      fullyUnlocked = unlocked;

      // Wir patchen beide Spuren! Dadurch sieht das Dashboard sofort den Sparstatus
      patchState(ns, {
        moneyReserve: reserve,
        financeProgress: financeProgress,
        traderMode: "EARLY",
        traderProgress: fullyUnlocked ? "Initialisiere..." : `Spare auf ${missingLicense}`
      });

      if (!fullyUnlocked) {
        const now = Date.now();
        if (now - lastLogTime > 60000) { // Log gedrosselt auf 60s
          logger.info(`⏳ Warte auf Budget für ${missingLicense}...`);
          lastLogTime = now;
        }
        await ns.sleep(6000); // 6s Markttakt für flüssige Dashboard-Updates!
        continue;
      }

      logger.success("🚀 Portfolio-Manager voll einsatzbereit. Starte Marktüberwachung.");
    }

    // --- 2. AB HIER IST DER ZUGRIFF AUF DIE STOCK-API SICHER (TIX UNLOCKED) ---
    const symbols = ns.stock.getSymbols();
    let totalLongValue = 0;
    let totalShortValue = 0;

    // --- 3. PHASE 1: EXISTIERENDE POSITIONEN LIQUIDIEREN ---
    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const [shares, avgPrice, sharesShort, avgPriceShort] = ns.stock.getPosition(sym);

      if (shares > 0) {
        totalLongValue += shares * ns.stock.getBidPrice(sym);
      }
      if (sharesShort > 0) {
        totalShortValue += sharesShort * ns.stock.getAskPrice(sym);
      }

      if (shares > 0 && forecast < 0.5) {
        const priceSold = ns.stock.sellStock(sym, shares);
        if (priceSold > 0) {
          const profit = (priceSold - avgPrice) * shares - TRANSACTION_FEE;
          logger.success(`[EXIT LONG] ${sym} | Profit: $${ns.format.number(profit, 2)}`);
          totalLongValue -= (shares * priceSold);
        }
      }

      if (canShort && sharesShort > 0 && forecast > 0.5) {
        const priceSoldShort = ns.stock.sellShort(sym, sharesShort);
        if (priceSoldShort > 0) {
          const profit = (avgPriceShort - priceSoldShort) * sharesShort - TRANSACTION_FEE;
          logger.success(`[EXIT SHORT] ${sym} | Profit: $${ns.format.number(profit, 2)}`);
          totalShortValue -= (sharesShort * priceSoldShort);
        }
      }
    }

    // --- 4. PHASE 2: MARKTANALYSE & PORTFOLIO-PRIORISIERUNG ---
    const buyCandidates: { sym: string; forecast: number; type: "LONG" | "SHORT"; strength: number; }[] = [];

    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const [shares, , sharesShort] = ns.stock.getPosition(sym);

      if (shares === 0 && sharesShort === 0) {
        if (forecast > 0.6) {
          buyCandidates.push({ sym, forecast, type: "LONG", strength: forecast - 0.5 });
        }
        else if (canShort && forecast < 0.4) {
          buyCandidates.push({ sym, forecast, type: "SHORT", strength: 0.5 - forecast });
        }
      }
    }

    buyCandidates.sort((a, b) => b.strength - a.strength);

    // --- 5. PHASE 3: GEZIELTES KAPITAL-INVESTMENT (Unter Berücksichtigung der Reserve!) ---
    for (const candidate of buyCandidates) {
      const currentMoney = ns.getPlayer().money;
      
      // Wir halten die eiserne Reserve UND die dynamische Reserve für Programme zurück!
      const activeReserve = Math.max(CASH_BUFFER, reserve);
      const availableBudget = currentMoney - activeReserve;

      if (availableBudget < MIN_INVESTMENT) break;

      const sym = candidate.sym;
      const [shares, , sharesShort] = ns.stock.getPosition(sym);
      const maxShares = ns.stock.getMaxShares(sym);
      
      const remainingShares = maxShares - (candidate.type === "LONG" ? shares : sharesShort);
      const sharePrice = candidate.type === "LONG" ? ns.stock.getAskPrice(sym) : ns.stock.getBidPrice(sym);

      let sharesToBuy = Math.floor((availableBudget - TRANSACTION_FEE) / sharePrice);
      sharesToBuy = Math.min(sharesToBuy, remainingShares);

      if (sharesToBuy > 0) {
        if (candidate.type === "LONG") {
          const pricePaid = ns.stock.buyStock(sym, sharesToBuy);
          if (pricePaid > 0) {
            logger.info(`📈 [ENTER LONG] ${sym} (${(candidate.forecast * 100).toFixed(0)}%) | ${ns.format.number(sharesToBuy)} Units`);
            totalLongValue += (sharesToBuy * pricePaid);
          }
        } else if (candidate.type === "SHORT" && canShort) {
          try {
            const pricePaidShort = ns.stock.buyShort(sym, sharesToBuy);
            if (pricePaidShort > 0) {
              logger.info(`📉 [ENTER SHORT] ${sym} (${(candidate.forecast * 100).toFixed(0)}%) | ${ns.format.number(sharesToBuy)} Units`);
              totalShortValue += (sharesToBuy * pricePaidShort);
            }
          } catch {
            canShort = false;
            logger.warn("ℹ️ Short-Selling deaktiviert. Schalte permanent auf [LONG-ONLY MODE].");
          }
        }
      }
    }

    // --- 6. STATE-UPDATE (SPUR 3 & 4) ---
    let progressString = "Suche Signale... 👀";
    if (totalLongValue > 0 || totalShortValue > 0) {
      const parts: string[] = [];
      if (totalLongValue > 0) parts.push(`L: $${ns.format.number(totalLongValue, 1)}`);
      if (totalShortValue > 0) parts.push(`S: $${ns.format.number(totalShortValue, 1)}`);
      progressString = parts.join(" | ");
    }

    patchState(ns, {
      moneyReserve: reserve,
      financeProgress: financeProgress,
      traderMode: "4S_ACTIVE",
      traderProgress: progressString
    });

    await ns.sleep(6000); // 6s Taktung perfekt abgestimmt auf den 4S-Markttick
  }
}