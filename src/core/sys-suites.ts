import { NS } from "@ns";
import { loadState } from "./state-manager.js";
import { loadBnMults } from "../lib/state.js";
import { manageSuites } from "../modules/suite-manager.js";
import { Logger } from "./logger.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Suites", "INFO");
  const bnMults = loadBnMults(ns);

  const scripts = {
    backdoor: "tasks/backdoor.js",
    trade: "systems/finance.js",
    hacknet: "systems/hacknet-early.js",
    sleeve: "core/sys-sleeve.js",
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
        scripts as any,
        currentState,
        triggerBackdoor,
        bnMults,
        logger
      );
    }
    await ns.sleep(5000); // Reicht völlig aus für passive Systeme
  }
}