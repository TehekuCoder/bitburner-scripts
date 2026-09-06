import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const action = String(ns.args[0] ?? "");
  const index = Number(ns.args[1] ?? -1);
  const amount = Number(ns.args[2] ?? 1);

  const numNodes = ns.hacknet.numNodes();
  const isValidIndex = index >= 0 && index < numNodes;

  switch (action) {
    case "hacknet-new-node":
      ns.hacknet.purchaseNode();
      break;
    case "hacknet-upgrade-level":
      if (isValidIndex) ns.hacknet.upgradeLevel(index, amount);
      break;
    case "hacknet-upgrade-ram":
      if (isValidIndex) ns.hacknet.upgradeRam(index, amount);
      break;
    case "hacknet-upgrade-core":
      if (isValidIndex) ns.hacknet.upgradeCore(index, amount);
      break;
    case "hacknet-upgrade-cache":
      if (isValidIndex) ns.hacknet.upgradeCache(index, amount);
      break;
  }
}