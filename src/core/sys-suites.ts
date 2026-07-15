// core/sys-suites.js

import { NS } from "@ns";
import { loadState } from "./state-manager.js";
import { loadBnMults } from "../lib/state.js";
import { manageSuites } from "../modules/suite-manager.js";
import { Logger } from "./logger.js";
import { ScriptList } from "./types.js"; // 🟢 Importiere deine Typen

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Suites", "INFO");
  const bnMults = loadBnMults(ns);

  // 🟢 Vollständiges Skript-Verzeichnis, damit der Suite-Manager alle Pfade kennt
  const scripts: ScriptList = {
    worker: "tasks/work.js",
    dispatcher: "core/sys-dispatcher.js",
    infra: "core/sys-infra.js",
    backdoor: "tasks/backdoor.js",
    xpfarm: "tasks/xp-grind.js",
    trade: "systems/finance.js",
    hacknet: "systems/hacknet-early.js",
    dnet: "core/dnet-master.js",
    crawler: "tasks/dnet-crawler.js",
    hack: "tasks/hack.js",
    grow: "tasks/grow.js",
    weaken: "tasks/weaken.js",
    sleeve: "core/sys-sleeve.js",
    dashboard: "core/sys-dashboard.js",
    // Falls dein Suite-Manager auch Gänge, Corps oder Bladeburner verwaltet,
    // kannst du sie hier bei Bedarf ergänzen.
  };

  let lastRootCount = -1;

  while (true) {
    const currentState = loadState(ns);
    if (currentState) {
      const currentRootCount = currentState.rootCount || 0;
      const triggerBackdoor = currentRootCount > lastRootCount;
      lastRootCount = currentRootCount;

      manageSuites(
        ns,
        scripts, // 🟢 Kein unsauberes "as any" mehr nötig!
        currentState,
        triggerBackdoor,
        bnMults,
        logger
      );
    }
    await ns.sleep(5000);
  }
}