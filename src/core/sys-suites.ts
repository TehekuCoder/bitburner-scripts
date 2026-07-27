import { NS } from "@ns";
import { manageSuites } from "daemons/suite-manager.js";
import { PATH_HACK, PATH_GROW, PATH_WEAKEN } from "/lib/constants.js";
import { LoggerClient as Logger } from "/lib/logger-client.js";
import { loadBnMults, loadState } from "/lib/state.js";
import { ScriptList } from "/lib/types.js";
import { PATHS } from "/lib/paths";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Suites");
  const bnMults = loadBnMults(ns);

  const scripts: ScriptList = {
    logger: PATHS.core.logger,
    perfMonitor: PATHS.daemons.perfMonitor,
    worker: PATHS.payloads.work,
    dispatcher: PATHS.core.dispatcher,
    infra: PATHS.managers.infra,
    backdoor: PATHS.daemons.backdoor,
    trade: PATHS.managers.finance,
    hacknet: PATHS.daemons.hacknetEarly,
    dnet: PATHS.managers.dnet,
    crawler: PATHS.daemons.crawler,
    hack: PATHS.payloads.hack,
    grow: PATHS.payloads.grow,
    weaken: PATHS.payloads.weaken,
    sleeve: PATHS.managers.sleeve,
    fillShare: PATHS.daemons.fillShare,
    augShopping: PATHS.tasks.augShopping,
    augAnalyze: PATHS.tasks.analyzeAug,
    orchestrator: PATHS.core.orchestrator,
    suites: PATHS.core.suites,
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
