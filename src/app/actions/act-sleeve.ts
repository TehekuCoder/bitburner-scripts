import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  if (!ns.sleeve) return;
  const action = String(ns.args[0] ?? "");

  if (action === "sleeve-purchase-aug") {
    const sleeveId = Number(ns.args[1] ?? -1);
    const augName = String(ns.args[2] ?? "");
    if (sleeveId >= 0 && augName) {
      ns.sleeve.purchaseSleeveAug(sleeveId, augName);
    }
  }
}