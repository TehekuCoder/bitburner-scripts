import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  while (true) {
    // Erhöht temporär den globalen Fraktions-Reputations-Multiplikator des Spielers
    await ns.share();
  }
}
