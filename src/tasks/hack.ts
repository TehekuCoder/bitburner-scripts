import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const target = ns.args[0] as string;
  const delay = Number(ns.args[1]) || 0;
  const batchId = (ns.args[2] as string) ?? "LEGACY";

  // Korrigiertes Log-Label
  ns.print(`[DEBUG] Weaken startet auf ${target}. Delay: ${delay}ms (Batch: ${batchId})`);

  // Korrigierter Funktionsaufruf
  if (delay > 0) {
    await ns.weaken(target, { additionalMsec: delay });
  } else {
    await ns.weaken(target);
  }
}