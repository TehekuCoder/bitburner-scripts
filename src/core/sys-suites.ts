import { NS } from "@ns";
import { manageSuites } from "daemons/suite-manager.js";
import { PATH_HACK, PATH_GROW, PATH_WEAKEN } from "/lib/constants";
import { Logger } from "/lib/logger";
import { loadBnMults, loadState } from "/lib/state";
import { ScriptList } from "/lib/types";


export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const logger = new Logger(ns, "Suites", "INFO");
  const bnMults = loadBnMults(ns);

  const scripts: ScriptList = {
    worker: "tasks/work.js",
    dispatcher: "core/sys-dispatcher.js",
    infra: "managers/infra-manager.js",
    backdoor: "daemons/backdoor.js",
    trade: "manager/finance-manager.js",
    hacknet: "daemons/hacknet-early.js",
    dnet: "manager/dnet-master.js",
    crawler: "tasks/dnet-crawler.js",
    hack: PATH_HACK,
    grow: PATH_GROW,
    weaken: PATH_WEAKEN,
    sleeve: "managers/sleeve-manager.js",
    fillShare: "daemons/fill-share.js",
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
