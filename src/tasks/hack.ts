import { NS } from "@ns";

// Optionale Erweiterung für tasks/hack.ts (analog für grow/weaken)
export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const target = ns.args[0] as string;
  const delay = (ns.args[1] as number) ?? 0;
  const batchId = (ns.args[2] as string) ?? "LEGACY"; // Hilft beim Debuggen im Late-Game

  if (delay > 0) {
    await ns.sleep(delay);
  }

  await ns.hack(target);
}
