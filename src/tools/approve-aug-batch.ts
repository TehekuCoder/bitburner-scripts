import { NS } from "@ns";
import { AUG_BATCH_APPROVAL_PORT } from "/shared/constants/finance.js";

export async function main(ns: NS): Promise<void> {
  const hasBatchPrefix =
    ns.args.length > 1 && String(ns.args[0]).toLowerCase() === "batch";
  const code = String(ns.args[hasBatchPrefix ? 1 : 0] ?? "").toLowerCase();
  if (
    (ns.args.length > 1 && !hasBatchPrefix) ||
    !/^[0-9a-f]{8}$/.test(code)
  ) {
    ns.tprint(
      "Verwendung: run tools/approve-aug-batch.js [batch] <Batch-Code aus dem Finance-Dashboard>",
    );
    return;
  }

  const requestId = `player-aug-batch-${code}`;
  if (!ns.tryWritePort(AUG_BATCH_APPROVAL_PORT, requestId)) {
    ns.tprint(
      `[ERROR] Aug-Batch-Freigabe konnte nicht gesendet werden (Port ${AUG_BATCH_APPROVAL_PORT} ist voll).`,
    );
    return;
  }

  ns.tprint(
    `[INFO] Kauf-Freigabe für Aug-Batch ${code} in Port ${AUG_BATCH_APPROVAL_PORT} eingestellt. Der Finance-Core muss laufen, um sie auszuwerten.`,
  );
}
