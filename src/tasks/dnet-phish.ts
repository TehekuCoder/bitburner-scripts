import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  // 🧠 Schritt 1: Blockierten RAM sofort freigeben (v3.0 dnet mechanic)
  await ns.dnet.memoryReallocation();

  // 🎣 Schritt 2: Das frisch gewonnene RAM für den Phishing-Angriff nutzen
  await ns.dnet.phishingAttack();
}