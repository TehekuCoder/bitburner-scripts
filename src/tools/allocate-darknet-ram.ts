import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const currentHost = ns.getHostname();
  let server = ns.getServer(currentHost);

  ns.tprint(`⚡ [Darknet RAM] Starte Re-Allocation auf ${currentHost}...`);

  let prevMaxRam = 0;
  while (true) {
    const currentMaxRam = ns.getServerMaxRam(currentHost);
    
    // Versuche blockiertes RAM freizugeben
    // HINWEIS: Je nach API-Typ ggf. ns.dnet.memoryReallocation() oder ns.dnet.influence.memoryReallocation()
    try {
      (ns.dnet as any).memoryReallocation?.() ?? (ns.dnet as any).influence?.memoryReallocation?.();
    } catch {
      ns.tprint("❌ ERROR: memoryReallocation Aufruf fehlgeschlagen.");
      break;
    }

    const newMaxRam = ns.getServerMaxRam(currentHost);
    if (newMaxRam === prevMaxRam) {
      // Kein RAM-Zuwachs mehr möglich
      break;
    }

    prevMaxRam = newMaxRam;
    await ns.sleep(200);
  }

  const finalRam = ns.getServerMaxRam(currentHost);
  ns.tprint(`✅ [Darknet RAM] Maximales RAM freigeschaltet: ${finalRam} GB auf ${currentHost}`);
}