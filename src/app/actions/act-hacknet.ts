import { NS } from "@ns";
import { runTrackedFinanceAction } from "./finance-action.js";

export async function main(ns: NS): Promise<void> {
  await runTrackedFinanceAction(ns, async () => {
    const action = String(ns.args[0] ?? "");
    const index = Number(ns.args[1] ?? -1);
    const amount = Number(ns.args[2] ?? 1);

    const numNodes = ns.hacknet.numNodes();
    const isValidIndex = index >= 0 && index < numNodes;

    switch (action) {
      case "hacknet-new-node":
        return ns.hacknet.purchaseNode() >= 0;
      case "hacknet-upgrade-level":
        return isValidIndex && ns.hacknet.upgradeLevel(index, amount);
      case "hacknet-upgrade-ram":
        return isValidIndex && ns.hacknet.upgradeRam(index, amount);
      case "hacknet-upgrade-core":
        return isValidIndex && ns.hacknet.upgradeCore(index, amount);
      case "hacknet-upgrade-cache":
        return isValidIndex && ns.hacknet.upgradeCache(index, amount);
      default:
        return false;
    }
  });
}