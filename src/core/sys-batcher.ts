import { NS, Player } from "@ns";
import { calculateBatch } from "../utils/batch-calculator.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  
  const target = "joesguns"; 

  ns.print(`[Batcher] Initialisiert für Ziel: ${target}`);

  while (true) {
    const player  = ns.getPlayer();

    // BEHOBEN (Fehler 2): Wir übergeben direkt 'target' (string) statt des Server-Objekts
    const plan = calculateBatch(ns, target, player.skills.hacking);

    // BEHOBEN (Fehler 1): Null-Guard einbauen. 
    // Wenn der Calculator null zurückgibt, schlafen wir kurz und versuchen es erneut.
    if (plan === null || !plan) {
      ns.print(`⚠️ [Batcher] Server ${target} ist noch nicht bereit für Batching (wird vermutlich noch geschwächt/gewachsen).`);
      await ns.sleep(5000); // Längere Pause, um Server-Vorbereitung abzuwarten
      continue;
    }

    // Ab hier weiß TypeScript zu 100%, dass 'plan' existiert und nicht null ist!
    ns.print(`[Batcher] Sende Batchwelle. Hack-Threads: ${plan.hackThreads}`);

    // Platzhalter für deine spätere exec()-Logik der Wellen:
    // ns.exec("tasks/hack.js", "p-serv-01", plan.hackThreads, target, plan.hackDelay);
    // ...

    await ns.sleep(2000); 
  }
}