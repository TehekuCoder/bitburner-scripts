import { NS } from "@ns";

/** * DYNAMIC RESOURCE ALLOCATOR (Mainframe Style)
 * Verwaltet share.js Instanzen basierend auf verfügbarem Workload.
 */
export async function main(ns: NS): Promise<void> {
  const target = "home";
  const script = "share.js";
  
  ns.disableLog("ALL");
  ns.ui.openTail(); // Optional: UI für Ressourcen-Monitor

  while (true) {
    const maxRam = ns.getServerMaxRam(target);
    const usedRam = ns.getServerUsedRam(target);
    const scriptRam = ns.getScriptRam(script);

    // Dynamischer Puffer: 5% des Gesamtspeichers oder mindestens 8GB
    // Das verhindert, dass das System bei kleinen RAM-Upgrades "erstickt"
    const reserve = Math.max(maxRam * 0.05, 8);

    // Aktuelle Threads ermitteln
    const shareProc = ns.ps(target).find(p => p.filename === script);
    const currentThreads = shareProc ? shareProc.threads : 0;

    // Verfügbarer RAM für Share (unter Berücksichtigung der laufenden Share-Threads)
    const availableRam = maxRam - (usedRam - (currentThreads * scriptRam)) - reserve;
    const targetThreads = Math.floor(availableRam / scriptRam);

    // Nur handeln, wenn die Abweichung signifikant ist (> 5% oder 0)
    // Das verhindert ständiges Kill/Restart bei minimalen Schwankungen
    const threadDiff = Math.abs(targetThreads - currentThreads);
    
    if (targetThreads !== currentThreads && (threadDiff > currentThreads * 0.05 || targetThreads === 0)) {
      if (currentThreads > 0) ns.scriptKill(script, target);
      
      if (targetThreads > 0) {
        ns.print(`[RESOURCE] Re-Allocating: ${targetThreads} Threads`);
        ns.exec(script, target, targetThreads);
      }
    }

    // Ein Intervall von 5s ist ein guter Kompromiss zwischen Last und Präzision
    await ns.sleep(5000);
  }
}