import { NS } from "@ns";
import { loadState } from "./state-manager.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  ns.ui.openTail();
  ns.ui.resizeTail(500, 340); // Leicht erhöht (340 statt 320), damit die Sleeves ohne Scrollbalken reinpassen!

  while (true) {
    const state = loadState(ns);
    ns.clearLog();

    if (!state) {
      ns.print("⏳ Warte auf System-State...");
      await ns.sleep(1000);
      continue;
    }

    // --- HELPER FÜR FARBCODIERTEN STATUS ---
    const formatStatus = (
      prog: string | undefined,
      inactiveKeywords = ["inaktiv", "kein", "idle", "off"], // "off" hier als Standard hinzugefügt
    ) => {
      if (!prog) return "\x1b[38;5;240mOFF\x1b[0m";
      const lower = prog.toLowerCase();
      if (inactiveKeywords.some((k) => lower.includes(k))) {
        return `\x1b[38;5;240m${prog}\x1b[0m`; // Grau für Inaktiv
      }
      if (
        lower.includes("aktiv") ||
        lower.includes("running") ||
        lower.includes("saving") ||
        lower.includes("sprint")
      ) {
        return `\x1b[1;32m${prog}\x1b[0m`; // Grün für aktive Arbeit
      }
      return `\x1b[1;33m${prog}\x1b[0m`; // Gelb für Übergänge/Warten (z.B. Shock/Sync %)
    };

    const printRow = (label: string, val: string) => {
      ns.print(` ${label.padEnd(12)} : ${val}`);
    };

    // --- HEADER ---
    ns.print(`==================================================`);
    ns.print(
      `🤖 \x1b[1;32mBIT-OS CORE MONITOR\x1b[0m               [BN ${state.currentBitNode ?? 1}.${state.currentBitNodeLevel ?? 1}]`,
    );
    ns.print(`==================================================`);

    // 1. System & Engine
    const rootCount = state.rootCount ?? 0;
    const totalNodes = state.totalNodes ?? 0;
    const modeStr = state.isFleetMode ? "FLEET" : "BASIC";

    printRow("STRATEGIE", `\x1b[1;35m${state.strategy}\x1b[0m (${modeStr})`);
    printRow(
      "NETZWERK",
      `\x1b[1;32m${rootCount}/${totalNodes}\x1b[0m rooted Nodes`,
    );

    ns.print(`--------------------------------------------------`);

    // 2. Hauptaktivität (Player Focus)
    ns.print(` \x1b[1;34m[ EXCLUSIVE MAIN TASK ]\x1b[0m`);
    const target =
      state.targetFaction || state.targetCompany || "Solo-Progression";
    printRow("ZIEL", `\x1b[38;5;250m${target}\x1b[0m`);
    printRow("STATUS", formatStatus(state.progressBar));

    ns.print(`--------------------------------------------------`);

    // 3. Parallel Background Scripts / Services
    ns.print(` \x1b[1;36m[ BACKGROUND SERVICES ]\x1b[0m`);

    // Batcher
    const bTarget = state.batcherTarget ? ` -> ${state.batcherTarget}` : "";
    printRow(
      "BATCHER",
      formatStatus(state.batcherProgress) +
        (state.batcherProgress !== "Inaktiv" ? bTarget : ""),
    );

    // Finanzen & Upgrades
    printRow("FINANZEN", formatStatus(state.financeProgress));

    // Hacknet
    printRow("HACKNET", formatStatus(state.hacknetProgress));

    // Stock Trader
    printRow("STOCKS", formatStatus(state.traderProgress));

    // Sleeves (wird jetzt absolut sauber farbcodiert!)
    if (state.sleeveProgress) {
      printRow("SLEEVES", formatStatus(state.sleeveProgress));
    }

    ns.print(`--------------------------------------------------`);

    // 4. Heartbeat
    const ageMs = Date.now() - (state.lastUpdate ?? Date.now());
    const ageSec = (ageMs / 1000).toFixed(1);
    let heartbeat = `\x1b[1;32mOK (${ageSec}s)\x1b[0m`;

    if (ageMs > 10000) heartbeat = `\x1b[5;1;31mDEAD (${ageSec}s)\x1b[0m`;
    else if (ageMs > 3000) heartbeat = `\x1b[1;33mLAGGING (${ageSec}s)\x1b[0m`;

    printRow("HEARTBEAT", heartbeat);

    await ns.sleep(1000);
  }
}