import { NS } from "@ns";
export async function main(ns: NS): Promise<void> {
  const target = ns.args[0] as string;
  const delay = (ns.args[1] as number) ?? 0; // Das vom Batcher berechnete Delay

  if (delay > 0) {
    await ns.sleep(delay); // Hier passiert die Magie des exakten Timings!
  }
  await ns.grow(target);
}
