// tasks/hack.ts
import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const target = ns.args[0] as string;
  const delay = Number(ns.args[1]) || 0;
  const batchId = (ns.args[2] as string) ?? "LEGACY";

  // 🟢 Korrigiertes Log-Label für echtes Hacking
  ns.print(`[DEBUG] Hack startet auf ${target}. Delay: ${delay}ms (Batch: ${batchId})`);

  // 🟢 Korrigierter Funktionsaufruf: ns.hack statt ns.weaken!
  if (delay > 0) {
    await ns.hack(target, { additionalMsec: delay });
  } else {
    await ns.hack(target);
  }
}