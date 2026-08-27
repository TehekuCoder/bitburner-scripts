import { CorporationInfo, NS } from "@ns";
import { loadCorporationState } from "/infrastructure/state/state";
import { CORP_CONFIG } from "/shared/constants/corporation";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  if (!Boolean(ns.corporation) || !ns.corporation.hasCorporation()) {
    ns.tprint(
      "🛑 Keine Corporation vorhanden. Dashboard kann nicht gestartet werden.",
    );
    return;
  }

  ns.ui.openTail();
  ns.ui.setTailTitle("🏢 BitOS Corporation System");
  ns.ui.resizeTail(840, 600);

  while (true) {
    const corp = ns.corporation.getCorporation();
    const corpState = loadCorporationState(ns);

    renderDashboard(
      ns,
      corp,
      corpState?.stage ?? "INIT_AGRI",
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

  const dividerHeader =
    "==================================================================================";
  const dividerSub =
    "----------------------------------------------------------------------------------";

  const profit = corp.revenue - corp.expenses;
  const profitStr =
    profit >= 0
      ? `+$${ns.format.number(profit)}/s`
      : `-$${ns.format.number(Math.abs(profit))}/s`;

  const investOffer = ns.corporation.getInvestmentOffer();

  ns.print(dividerHeader);
  ns.print(
    ` 🏢 BitOS CORP SYSTEM | ${corp.name} | Aktuelle Phase: [ ${stage} ]`,
  );
  ns.print(dividerHeader);
  ns.print(
    ` Capital: $${ns.format.number(corp.funds)} | ` +
      `Revenue: $${ns.format.number(corp.revenue)}/s | ` +
      `Expenses: $${ns.format.number(corp.expenses)}/s`,
  );
  ns.print(
    ` Net Profit: ${profitStr} | ` +
      `Investor (R${investOffer.round}): $${ns.format.number(investOffer.funds)} (${ns.format.number(investOffer.shares)} Shares)`,
  );

  ns.print(dividerSub);
  ns.print(
    " DIVISION        | TYPE        | CITIES | OFFICES | DETAILS / CAPACITY",
  );
  ns.print(dividerSub);

  for (const divName of corp.divisions) {
    const div = ns.corporation.getDivision(divName);
    const divNameStr = div.name.padEnd(15);
    const divType = (div.industry ?? "N/A").padEnd(11);
    const cityCount = `${div.cities.length}/6`.padEnd(6);

    let totalOfficeSize = 0;
    let totalWarehouseLevel = 0;
    for (const city of div.cities) {
      if (ns.corporation.hasWarehouse(div.name, city)) {
        totalWarehouseLevel += ns.corporation.getWarehouse(
          div.name,
          city,
        ).level;
      }
      totalOfficeSize += ns.corporation.getOffice(div.name, city).size;
    }
    const avgOffice = Math.round(totalOfficeSize / (div.cities.length || 1));
    const avgWh = Math.round(totalWarehouseLevel / (div.cities.length || 1));

    let detailsStr = "";
    if (div.makesProducts) {
      let maxProducts = 3;
      if (ns.corporation.hasResearched(div.name, "uPgrade: Capacity.I"))
        maxProducts++;
      if (ns.corporation.hasResearched(div.name, "uPgrade: Capacity.II"))
        maxProducts++;

      detailsStr = `Prods: ${div.products.length}/${maxProducts} (Wh-Lvl ~${avgWh})`;
    } else {
      detailsStr = `Wh-Lvl: ~${avgWh}`;
    }

    ns.print(
      ` ${divNameStr} | ${divType} | ${cityCount} | Size ~${avgOffice.toString().padEnd(3)} | ${detailsStr}`,
    );
  }

  ns.print(dividerSub);
  renderPhaseChecklist(ns, stage, corp);
  ns.print(dividerHeader);

  if (localLogBuffer.length > 0) {
    ns.print(" LETZTE AKTIONEN:");
    for (const logLine of localLogBuffer) {
      ns.print(`   ${logLine}`);
    }
    ns.print(dividerSub);
  }
}

function renderPhaseChecklist(
  ns: NS,
  stage: string,
  corp: CorporationInfo,
): void {
  ns.print(" PHASEN-FORTSCHRITT & ZIELE:");

  const offer = ns.corporation.getInvestmentOffer().funds;
  const agriName = CORP_CONFIG.divisions.agri.name;
  const chemName = CORP_CONFIG.divisions.chem.name;
  const tobaccoName = CORP_CONFIG.divisions.tobacco.name;

  const hasAgri = corp.divisions.includes(agriName);
  const hasChem = corp.divisions.includes(chemName);
  const hasTobacco = corp.divisions.includes(tobaccoName);

  switch (stage) {
    case "INIT_AGRI":
    case "AGRI_BOOST": {
      const agriOfficeSize = hasAgri
        ? ns.corporation.getOffice(agriName, CORP_CONFIG.mainCity).size
        : 0;
      ns.print(
        `  [${hasAgri ? "X" : " "}] ${agriName} Sparte gegründet & 6 Städte freigeschaltet`,
      );
      ns.print(
        `  [${agriOfficeSize >= CORP_CONFIG.officeSizes.phase1 ? "X" : " "}] Büros auf ${CORP_CONFIG.officeSizes.phase1} Mitarbeiter eingerichtet`,
      );
      ns.print(
        `  [ ] Booster-Materialien R1 (HW: 125, AI: 75, RE: 27k) kaufen`,
      );
      break;
    }

    case "INVESTOR_1":
      ns.print(`  [X] ${agriName} Booster R1 abgeschlossen`);
      ns.print(`  [ ] Profit-Spike auslösen (Lager füllen & entleeren)`);
      ns.print(
        `  [${offer > 0 ? "X" : " "}] Investor 1 Angebot abwarten (Aktuell: $${ns.format.number(offer)})`,
      );
      break;

    case "INIT_CHEM":
    case "EXPORT_LOOP": {
      const agriOffice = hasAgri
        ? ns.corporation.getOffice(agriName, CORP_CONFIG.mainCity).size
        : 0;
      const chemOffice = hasChem
        ? ns.corporation.getOffice(chemName, CORP_CONFIG.mainCity).size
        : 0;
      const isUpgraded =
        agriOffice >= CORP_CONFIG.officeSizes.phase2 &&
        chemOffice >= CORP_CONFIG.officeSizes.phase2;

      ns.print(`  [X] Investor 1 abgeschlossen`);
      ns.print(`  [${hasChem ? "X" : " "}] ${chemName} Sparte gegründet`);
      ns.print(
        `  [${isUpgraded ? "X" : " "}] Büros auf ${CORP_CONFIG.officeSizes.phase2} Mitarbeiter skaliert (${agriOffice}/${CORP_CONFIG.officeSizes.phase2} Agri | ${chemOffice}/${CORP_CONFIG.officeSizes.phase2} Chem)`,
      );
      ns.print(
        `  [ ] Exporte (Agri <-> Chem) & Booster R2 Einkäufe aktiv`,
      );
      break;
    }

    case "INVESTOR_2":
      ns.print(`  [X] Export-Loop & R2-Skalierung abgeschlossen`);
      ns.print(`  [ ] Profit-Spike für ${agriName} & ${chemName} auslösen`);
      ns.print(
        `  [${offer > 0 ? "X" : " "}] Investor 2 Angebot abwarten (Aktuell: $${ns.format.number(offer)})`,
      );
      break;

    case "INIT_TOBACCO": {
      const mainOfficeSize = hasTobacco
        ? ns.corporation.getOffice(tobaccoName, CORP_CONFIG.mainCity).size
        : 0;
      ns.print(`  [X] Investor 2 Kapital erhalten`);
      ns.print(
        `  [${hasTobacco ? "X" : " "}] Endgame-Sparte ${tobaccoName} gegründet`,
      );
      ns.print(
        `  [${mainOfficeSize >= 60 ? "X" : " "}] Hauptsitz (${CORP_CONFIG.mainCity}) auf 60 Mitarbeiter ausgebaut (${mainOfficeSize}/60)`,
      );
      break;
    }

    case "TOBACCO_LOOP": {
      const hasTA2 = hasTobacco
        ? ns.corporation.hasResearched(tobaccoName, "Market-TA.II")
        : false;
      const cap1 = hasTobacco
        ? ns.corporation.hasResearched(tobaccoName, "uPgrade: Capacity.I")
        : false;
      const cap2 = hasTobacco
        ? ns.corporation.hasResearched(tobaccoName, "uPgrade: Capacity.II")
        : false;

      ns.print(`  [X] ${tobaccoName}-Entwicklungsschleife aktiv`);
      ns.print(
        `  [${hasTA2 ? "X" : " "}] Market-TA.II erforscht (Automatischer Optimalpreis)`,
      );
      ns.print(
        `  [${cap1 && cap2 ? "X" : cap1 ? "/" : " "}] Produkt-Kapazitäten erweitert (Cap I: ${cap1 ? "✓" : "✗"}, Cap II: ${cap2 ? "✓" : "✗"})`,
      );
      ns.print(
        `  [${corp.public ? "X" : " "}] Börsengang (IPO) durchgeführt & Dividenden aktiv`,
      );
      break;
    }

    default:
      ns.print(`  [ ] Aktive Phase: ${stage}`);
  }
}