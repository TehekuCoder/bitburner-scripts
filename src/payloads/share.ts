import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  while (true) {
    // ns.share() dauert exakt 10 Sekunden und yields automatisch
    await ns.share();
  }
}