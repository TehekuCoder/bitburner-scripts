import { NS, FactionName } from "@ns";
import { runTrackedFinanceAction } from "./finance-action.js";

export async function main(ns: NS): Promise<void> {
  await runTrackedFinanceAction(ns, () => {
    if (!ns.singularity || ns.getResetInfo().currentNode !== 8) return false;

    const faction = String(ns.args[1] ?? "") as FactionName;
    const amount = Number(ns.args[2]);
    if (
      !faction ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !ns.getPlayer().factions.includes(faction) ||
      ns.getServerMoneyAvailable("home") < amount
    ) {
      return false;
    }

    return ns.singularity.donateToFaction(faction, amount);
  });
}
