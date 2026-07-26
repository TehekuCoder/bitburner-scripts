import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const target = ns.args[0] as string;
  // args[1] kann eine Batch-ID oder ein Timestamp sein (z.B. "b123" oder Date.now())
  // Bitburner ignoriert ungenutzte Argumente bei weaken(), nutzt sie aber zur PID-Unterscheidung
  await ns.weaken(target);
}