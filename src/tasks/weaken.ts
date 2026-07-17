import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const target = ns.args[0] as string;
  
  // 🟢 KUGELSICHER: Laufzeit-Konvertierung zu einer echten Zahl
  const delay = Number(ns.args[1]) || 0;
  const batchId = (ns.args[2] as string) ?? "LEGACY";

  // Debug-Anzeige im Skript-Log (kannst du später auskommentieren)
  ns.print(`[DEBUG] Weaken startet auf ${target}. Delay: ${delay}ms (Batch: ${batchId})`);

  if (delay > 0) {
    await ns.weaken(target, { additionalMsec: delay });
  } else {
    await ns.weaken(target);
  }
}