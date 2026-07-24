import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const currentHost = ns.getHostname();

  try {
    // 🧠 Schritt 1: Blockierten RAM freigeben
    await ns.dnet.memoryReallocation(currentHost);

    // 🎣 Schritt 2: Phishing starten
    await ns.dnet.phishingAttack();
  } catch (e) {
    ns.tprint(`🔴 [PHISH] Fehler auf ${currentHost}: ${e}`);
  }
}