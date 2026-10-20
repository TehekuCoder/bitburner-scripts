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
    await publishResult(ns, requestId, false, startingMoney);
    throw error;
  }

  await publishResult(ns, requestId, success, startingMoney);
}

async function publishResult(
  ns: NS,
  requestId: string,
  success: boolean,
  startingMoney: number,
): Promise<void> {
  if (!requestId) return;

  const result: FinanceActionResult = {
    requestId,
    success,
    actualCost: Math.max(0, startingMoney - ns.getServerMoneyAvailable("home")),
  };
  const serializedResult = JSON.stringify(result);
  const maxAttempts = 50;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (ns.tryWritePort(FINANCE_RESULT_PORT, serializedResult)) return;
    await ns.sleep(100);
  }

  ns.print(
    `[FINANCE-ACTION] Ergebnis für ${requestId} konnte nach ${maxAttempts} Versuchen nicht auf Port ${FINANCE_RESULT_PORT} geschrieben werden.`,
  );
}
