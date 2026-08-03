// tools/karma.ts
import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  // Versteckte API-Aufrufe nutzen
  const karma = (ns as unknown as { heart: { break: () => number } }).heart.break();
  const player = ns.getPlayer();

  ns.tprint("=================================");
  ns.tprint(`📊 Karma:        ${ns.format.number(karma, 2)} / -54,000 (Gang Unlock)`);
  ns.tprint(`💀 People Killed: ${player.numPeopleKilled}`);
  ns.tprint("=================================");
}