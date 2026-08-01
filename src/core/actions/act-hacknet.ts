import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const action = String(ns.args[0] ?? "");
  const index = Number(ns.args[1] ?? -1);
  const amount = Number(ns.args[2] ?? 1);

  switch (action) {
    case "hacknet-new-node":
      ns.hacknet.purchaseNode();
      break;
    case "hacknet-upgrade-level":
      if (index >= 0) ns.hacknet.upgradeLevel(index, amount);
      break;
    case "hacknet-upgrade-ram":
      if (index >= 0) ns.hacknet.upgradeRam(index, amount);
      break;
    case "hacknet-upgrade-core":
      if (index >= 0) ns.hacknet.upgradeCore(index, amount);
      break;
  }
}