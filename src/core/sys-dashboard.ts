import { NS } from "@ns";
import { loadState } from "./state-manager.js";
import { loadBnMults } from "../lib/state.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.ui.resizeTail(640, 480);

  const bnMults = loadBnMults(ns);

  while (true) {
    const state = loadState(ns);
    ns.clearLog();

    if (!state) {
      ns.print("⏳ Warte auf Initialisierung des System-States...");
      await ns.sleep(1000);
      continue;
    }

    const sources = state.sources || {};

    // 🛡️ ANSI-SICHERES ALIGNMENT-WERKZEUG
    const printRow = (
      label: string,
      val: string | number | boolean,
      stateKey?: string,
    ) => {
      const source = stateKey ? `[${sources[stateKey] || "Init"}]` : "";
      const paddedLabel = label.padEnd(15);
      const valStr = String(val);

      // Entfernt alle ANSI-Farbcodes für eine präzise visuelle Breitenberechnung
      const visualLen = valStr.replace(
        /[\u001b\u009b][[()#;?]*(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?/g,
        "",
      ).length;
      const paddingNeeded = Math.max(0, 25 - visualLen);
      const paddedVal = valStr + " ".repeat(paddingNeeded);

      ns.print(` ${paddedLabel} : ${paddedVal} \x1b[38;5;244m${source}\x1b[0m`);
    };

    ns.print(
      `==================================================================`,
    );
    ns.print(`👑 \x1b[1;32mBIT-OS CONSOLIDATED OPERATIONAL DASHBOARD\x1b[0m`);
    ns.print(
      `==================================================================`,
    );

    // 1. System & Netzwerk Status
    const rootCount = state.rootCount ?? 0;
    const totalNodes = state.totalNodes ?? 0;
    printRow("NETWORK UNITS", `${rootCount}/${totalNodes}`, "rootCount");
    printRow(
      "ENGINE MODE",
      state.isFleetMode ? "DYNAMIC FLEET" : "BASIC LOOP",
      "isFleetMode",
    );
    printRow("STRATEGIE", state.strategy, "strategy");

    // 🏆 1.5 Progression & Unlocks (Vollautomatisch durch Kernel-Erfassung)
    const bitNodeStr = `BN ${state.currentBitNode ?? 10}.${state.currentBitNodeLevel ?? 2}`;
    printRow("CURRENT BITNODE", bitNodeStr, "currentBitNode");

    const formatUnlock = (active: boolean, name: string) => {
      return active
        ? `\x1b[1;32m${name}\x1b[0m`
        : `\x1b[38;5;240m${name}\x1b[0m`;
    };
    const torStr = formatUnlock(!!state.hasTorRouter, "TOR");
    const gangStr = formatUnlock(!!state.hasGang, "GANG");
    const corpStr = formatUnlock(!!state.hasCorporation, "CORP");
    const bladeStr = formatUnlock(!!state.hasBladeburner, "BLADE");
    printRow(
      "UNLOCKED SVCS",
      `${torStr} | ${gangStr} | ${corpStr} | ${bladeStr}`,
    );

    ns.print(
      `------------------------------------------------------------------`,
    );

    // 2. Primäre Fokus-Aktivität (Exklusiver Spieler-Task)
    ns.print(` \x1b[1;34m[ MAIN PLAYER FOCUS ]\x1b[0m`);
    printRow("FRAKTION", state.targetFaction || "KEINE", "targetFaction");
    printRow("COMPANY", state.targetCompany || "KEINE", "targetCompany");
    printRow("PROGRESS", state.progressBar || "Idle", "progressBar");

    ns.print(
      `------------------------------------------------------------------`,
    );

    // 3. Parallele Sub-Systeme (Neu im Multi-Lane System!)
    ns.print(` \x1b[1;36m[ PARALLEL BACKGROUND SERVICES ]\x1b[0m`);
    printRow("BATCHING", state.batcherProgress || "Inaktiv", "batcherProgress");
    printRow(
      "FINANCES",
      state.financeProgress || "Berechne Budget...",
      "financeProgress",
    );
    printRow("HACKNET", state.hacknetProgress || "Inaktiv", "hacknetProgress");
    printRow(
      "STOCK TRADING",
      state.traderProgress || "Kein Depot",
      "traderProgress",
    );

    ns.print(
      `------------------------------------------------------------------`,
    );

    // 4. BitNode Multiplikatoren (Statische Configs)
    const hackYield = (
      bnMults.ServerMaxMoney *
      bnMults.ScriptHackMoneyGain *
      100
    ).toFixed(0);
    const weakenRate = (bnMults.ServerWeakenRate * 100).toFixed(0);
    printRow("HACK-YIELD", `${hackYield}% Effizienz`);
    printRow("WEAKEN-RATE", `${weakenRate}% Tempo`);

    ns.print(
      `------------------------------------------------------------------`,
    );

    // 5. Metadata & System-Taktung (Als System-Watchdog)
    const ageMs = Date.now() - (state.lastUpdate ?? Date.now());
    const ageSeconds = (ageMs / 1000).toFixed(1);

    let heartbeatStr = "";
    if (ageMs > 10000) {
      // Über 10 Sekunden alt -> Tot oder schwerer Lag! (Blinkend Rot)
      heartbeatStr = `\x1b[5;1;31mWARNING (${ageSeconds}s ago)\x1b[0m`;
    } else if (ageMs > 3000) {
      // Über 3 Sekunden alt -> Subsysteme verzögert (Gelb)
      heartbeatStr = `\x1b[1;33mDELAYED (${ageSeconds}s ago)\x1b[0m`;
    } else {
      // Alles im grünen Bereich (Grün)
      heartbeatStr = `\x1b[1;32mHEALTHY (${ageSeconds}s ago)\x1b[0m`;
    }

    printRow("SYS HEARTBEAT", heartbeatStr, "lastUpdate");

    await ns.sleep(1000); // 1 Sekunde Taktung ist perfekt für die UI
  }
}
