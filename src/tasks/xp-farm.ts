import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  // Das Ziel wird als String aus den Argumenten gezogen
  const target = ns.args[0] as string;

  if (!target) {
    ns.tprint("❌ Fehler: Kein Ziel-Server angegeben!");
    return;
  }

  while (true) {
    // Wir ignorieren Geld und Sicherheit komplett. 
    // Wir wollen nur die XP vom Weaken-Befehl.
    await ns.weaken(target);
  }
}