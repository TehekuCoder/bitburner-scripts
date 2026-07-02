import { NS } from "@ns";
export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const target = ns.args[0] as string;
  const delay = (ns.args[1] as number) ?? 0; // Das vom Batcher berechnete Delay
  const batchId = (ns.args[2] as string) ?? "LEGACY"; // Hilft beim Debuggen im Late-Game

  if (delay > 0) {
    await ns.sleep(delay); // Hier passiert die Magie des exakten Timings!
  }
  await ns.grow(target);
}
