// src/core/sys-suite.ts

import { NS } from "@ns";
import { loadState } from "./state-manager.js";
import { loadBnMults } from "../lib/state.js";
import { manageSuites } from "../modules/suite-manager.js";
import { Logger } from "./logger.js";
import { ScriptList } from "./types.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Suites", "INFO");
  const bnMults = loadBnMults(ns);

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
  };

  while (true) {
    const currentState = loadState(ns);
    if (currentState) {
      // Der Suite-Manager entscheidet nun selbst anhand des echten Netzwerk-Zustands!
      manageSuites(
        ns,
        scripts,
        currentState,
        bnMults,
        logger
      );
    }
    await ns.sleep(5000); // Alle 5 Sekunden reicht völlig und schont die CPU
  }
}