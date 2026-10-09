import { NS } from "@ns";
import { AUG_BATCH_APPROVAL_PORT } from "/shared/constants/finance.js";

export async function main(ns: NS): Promise<void> {
  const approvalType = ns.args.length > 1 ? String(ns.args[0]) : "batch";
  const code = String(ns.args[ns.args.length > 1 ? 1 : 0] ?? "").toLowerCase();
  if (approvalType !== "batch" && approvalType !== "install") {
    ns.tprint(
      "Verwendung: run tools/approve-aug-batch.js [batch|install] <Batch-Code>",
    );
    return;
  }
  if (!/^[0-9a-f]{8}$/.test(code)) {
    ns.tprint(
      "Verwendung: run tools/approve-aug-batch.js [batch|install] <Batch-Code aus dem Finance-Dashboard>",
    );
    return;
  }

  const requestId =
    approvalType === "install"
      ? `player-install-augs-${code}`
      : `player-aug-batch-${code}`;
  if (!ns.tryWritePort(AUG_BATCH_APPROVAL_PORT, requestId)) {
    ns.tprint(
      `[ERROR] Aug-Batch-Freigabe konnte nicht gesendet werden (Port ${AUG_BATCH_APPROVAL_PORT} ist voll).`,
    );
    return;
  }

  ns.tprint(
    `[INFO] Freigabe für ${approvalType === "install" ? "Installation" : "Aug-Batch"} ${code} gesendet.`,
  );
}
