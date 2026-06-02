import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  // share() profitiert nicht von Argumenten, also halten wir es puristisch.
  while (true) {
    await ns.share();
  }
}