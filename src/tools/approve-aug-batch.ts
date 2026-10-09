import { NS } from "@ns";
import { AUG_BATCH_APPROVAL_PORT } from "/shared/constants/finance.js";

export async function main(ns: NS): Promise<void> {
  const code = String(ns.args[0] ?? "").toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(code)) {
    ns.tprint(
      "Verwendung: run tools/approve-aug-batch.js <Batch-Code aus dem Finance-Dashboard>",
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

  ns.tprint(`[INFO] Freigabe für Aug-Batch ${code} gesendet.`);
}
