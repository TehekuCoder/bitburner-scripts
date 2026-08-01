import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  if (!ns.gang) return;
  const action = String(ns.args[0] ?? "");

  if (action === "gang-buy-equipment") {
    const memberName = String(ns.args[1] ?? "");
    const equipName = String(ns.args[2] ?? "");
    if (memberName && equipName) {
      ns.gang.purchaseEquipment(memberName, equipName);
    }
  }
}