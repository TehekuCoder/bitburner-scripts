import { NS, ProgramName } from "@ns";
import { runTrackedFinanceAction } from "./finance-action.js";

export async function main(ns: NS): Promise<void> {
  await runTrackedFinanceAction(ns, () => {
    if (!ns.singularity) return false;

    const action = String(ns.args[0] ?? "");
    if (action === "program-purchase-tor" && ns.args.length === 1) {
      return ns.singularity.purchaseTor();
    }

    if (action === "program-purchase" && ns.args.length === 2) {
      const program = String(ns.args[1] ?? "") as ProgramName;
      return program ? ns.singularity.purchaseProgram(program) : false;
    }

    return false;
  });
}
