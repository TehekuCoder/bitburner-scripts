import { NS } from "@ns";
import {
  FINANCE_REQUEST_ARG_PREFIX,
  FINANCE_RESULT_PORT,
} from "/shared/constants/finance";
import { FinanceActionResult } from "/shared/types/finance.js";

export async function runTrackedFinanceAction(
  ns: NS,
  action: () => boolean | Promise<boolean>,
): Promise<void> {
  const marker = ns.args[ns.args.length - 1];
  const requestId =
    typeof marker === "string" && marker.startsWith(FINANCE_REQUEST_ARG_PREFIX)
      ? marker.slice(FINANCE_REQUEST_ARG_PREFIX.length)
      : "";
  const startingMoney = requestId ? ns.getServerMoneyAvailable("home") : 0;

  let success = false;
  try {
    success = await action();
  } catch (error) {
    publishResult(ns, requestId, false, startingMoney);
    throw error;
  }

  publishResult(ns, requestId, success, startingMoney);
}

function publishResult(
  ns: NS,
  requestId: string,
  success: boolean,
  startingMoney: number,
): void {
  if (!requestId) return;

  const result: FinanceActionResult = {
    requestId,
    success,
    actualCost: Math.max(0, startingMoney - ns.getServerMoneyAvailable("home")),
  };
  if (!ns.tryWritePort(FINANCE_RESULT_PORT, JSON.stringify(result))) {
    ns.print(
      `[FINANCE-ACTION] Ergebnis für ${requestId} konnte nicht auf Port ${FINANCE_RESULT_PORT} geschrieben werden.`,
    );
  }
}
