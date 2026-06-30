import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const target = ns.args[0] as string || "joesguns";

  if (!target) {
    ns.tprint("❌ Fehler: Kein Ziel-Server angegeben!");
    return;
  }

  ns.disableLog("ALL"); // Schont die CPU bei massiver Thread-Flutung

  while (true) {
    // Reines XP-Grinding: Ignoriert Geld/Security für maximale Hacking-EXP pro Sekunde
    await ns.weaken(target);
  }
}