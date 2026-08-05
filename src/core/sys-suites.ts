import { NS } from "@ns";
import { manageSuites } from "daemons/suite-manager.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { loadState } from "/lib/state.js";
import { PATHS } from "/lib/paths";
import { ScriptList } from "/lib/types/common";
import { loadBnMults } from "/lib/utils";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Suites");
  const bnMults = loadBnMults(ns);

  const scripts: ScriptList = {
    financeManager: PATHS.daemons.financeManager,
    financeCore: PATHS.core.financeCore,
    logger: PATHS.core.logger,
    perfMonitor: PATHS.daemons.perfMonitor,
    worker: PATHS.payloads.work,
    dispatcher: PATHS.core.dispatcher,
    backdoor: PATHS.daemons.backdoor,
    dnet: PATHS.managers.dnet,
    crawler: PATHS.daemons.crawler,
    hack: PATHS.payloads.hack,
    grow: PATHS.payloads.grow,
    weaken: PATHS.payloads.weaken,
    sleeve: PATHS.managers.sleeve,
    fillShare: PATHS.daemons.fillShare,
    augAnalyze: PATHS.tasks.analyzeAug,
    orchestrator: PATHS.core.orchestrator,
    suites: PATHS.core.suites,
    gang: PATHS.managers.gang,
    hashManager: PATHS.managers.hash,
  };

  while (true) {
    const currentState = loadState(ns);
    if (currentState) {
      // Der Suite-Manager entscheidet nun selbst anhand des echten Netzwerk-Zustands!
      manageSuites(ns, scripts, currentState, bnMults, logger);
    }
    await ns.sleep(5000); // Alle 5 Sekunden reicht völlig und schont die CPU
  }
}
