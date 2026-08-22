import { NS, CorporationInfo } from "@ns";
import { loadCorporationState } from "/infrastructure/state/state.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  if (!Boolean(ns.corporation) || !ns.corporation.hasCorporation()) {
    ns.tprint("🛑 Keine Corporation vorhanden. Dashboard kann nicht gestartet werden.");
    return;
  }

  ns.ui.openTail();
  ns.ui.setTailTitle("🏢 BitOS Corporation System");
  ns.ui.resizeTail(800, 420);

  while (true) {
    const corp = ns.corporation.getCorporation();
    const corpState = loadCorporationState(ns);

    renderDashboard(
      ns,
      corp,
      corpState?.stage ?? "RUNNING",
      corpState?.corpRecentLogs ?? [],
    );

    await ns.sleep(1000);
  }
}

function renderDashboard(
  ns: NS,
  corp: CorporationInfo,
  stage: string,
  localLogBuffer: string[],
): void {
  ns.clearLog();

  const dividerHeader = "==============================================================================";
  const dividerSub    = "------------------------------------------------------------------------------";

  const profit = corp.revenue - corp.expenses;
  const profitStr = profit >= 0 
    ? `+$${ns.format.number(profit)}/s` 
    : `-$${ns.format.number(Math.abs(profit))}/s`;

  const investOffer = ns.corporation.getInvestmentOffer();

  ns.print(dividerHeader);
  ns.print(` 🏢 BitOS CORP SYSTEM | ${corp.name} | Stage: ${stage}`);
  ns.print(dividerHeader);
  ns.print(
    ` Funds: $${ns.format.number(corp.funds)} | ` +
    `Revenue: $${ns.format.number(corp.revenue)}/s | ` +
    `Expenses: $${ns.format.number(corp.expenses)}/s`,
  );
  ns.print(
    ` Net Profit: ${profitStr} | ` +
    `Invest Offer: $${ns.format.number(investOffer.funds)} (${investOffer.shares} Shares)`,
  );
  ns.print(dividerSub);
  ns.print(" DIVISION        | TYPE        | CITIES | OFFICES | PRODUCTS / WAREHOUSE");
  ns.print(dividerSub);

  for (const divName of corp.divisions) {
    const div = ns.corporation.getDivision(divName);
    const divNameStr = div.name.padEnd(15);
    const divType = ((div as { type?: string }).type ?? "N/A").padEnd(11);
    const cityCount = `${div.cities.length}/6`.padEnd(6);
    
    let totalOfficeSize = 0;
    let totalWarehouseLevel = 0;
    for (const city of div.cities) {
      if (ns.corporation.hasWarehouse(div.name, city)) {
        totalWarehouseLevel += ns.corporation.getWarehouse(div.name, city).level;
      }
      totalOfficeSize += ns.corporation.getOffice(div.name, city).size;
    }
    const avgOffice = Math.round(totalOfficeSize / (div.cities.length || 1));
    const avgWh = Math.round(totalWarehouseLevel / (div.cities.length || 1));

    const prodInfo = div.makesProducts 
      ? `Prods: ${div.products.length}/3` 
      : `Wh-Lvl: ~${avgWh}`;

    ns.print(` ${divNameStr} | ${divType} | ${cityCount} | Size ~${avgOffice} | ${prodInfo}`);
  }

  ns.print(dividerHeader);

  if (localLogBuffer.length > 0) {
    ns.print(" LETZTE AKTIONEN:");
    for (const logLine of localLogBuffer) {
      ns.print(`   ${logLine}`);
    }
    ns.print(dividerSub);
  }
}