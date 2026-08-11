import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const currentHost = ns.getHostname();
  try {
    await ns.dnet.memoryReallocation(currentHost);
    await ns.dnet.phishingAttack();
  } catch (e) {
    ns.tprint(`🔴 [PHISH] Fehler auf ${currentHost}: ${e}`);
  }
}