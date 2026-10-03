import { NS } from "@ns";
import { runTrackedFinanceAction } from "./finance-action.js";

export async function main(ns: NS): Promise<void> {
  await runTrackedFinanceAction(ns, async () => {
    if (!ns.gang) return false;
    const action = String(ns.args[0] ?? "");

    if (action !== "gang-buy-equipment") return false;
    const memberName = String(ns.args[1] ?? "");
    const equipName = String(ns.args[2] ?? "");
    if (!memberName || !equipName) return false;
    return ns.gang.purchaseEquipment(memberName, equipName);
  });
}