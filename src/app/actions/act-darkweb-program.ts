import { NS, ProgramName } from "@ns";
import { runTrackedFinanceAction } from "./finance-action.js";
import { FINANCE_REQUEST_ARG_PREFIX } from "/shared/constants/finance";

export async function main(ns: NS): Promise<void> {
  await runTrackedFinanceAction(ns, () => {
    if (!ns.singularity) return false;

    const marker = ns.args[ns.args.length - 1];
    const actionArgs =
      typeof marker === "string" && marker.startsWith(FINANCE_REQUEST_ARG_PREFIX)
        ? ns.args.slice(0, -1)
        : ns.args;

    const action = String(actionArgs[0] ?? "");
    if (action === "program-purchase-tor" && actionArgs.length === 1) {
      return ns.singularity.purchaseTor();
    }

    if (action === "program-purchase" && actionArgs.length === 2) {
      const program = String(actionArgs[1] ?? "") as ProgramName;
      return program ? ns.singularity.purchaseProgram(program) : false;
    }

    return false;
  });
}
