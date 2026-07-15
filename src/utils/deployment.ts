import { NS } from "@ns";
import { ScriptList } from "../core/types.js"; // Import aus neutraler Datei!

/**
 * Verteilt Worker-Skripte auf einem Ziel-Server und maximiert die Thread-Auslastung.
 * Komplett synchron und ohne blockierenden Overhead!
 */
export function deployWorker(
  ns: NS,
  targetNode: string,
  scriptFilename: string,
  hackTarget: string,
  ramBuffer: number,
  scripts: ScriptList,
): void {
  // 1. Quellcode-Validierung
  if (!ns.fileExists(scriptFilename, "home")) return;

  // 2. Alte Prozesse identifizieren und restlos terminieren
  const procs = ns.ps(targetNode);
  const allWorkerScripts = [
    scripts.worker,
    scripts.xpfarm,
    scripts.hack,
    scripts.grow,
    scripts.weaken,
  ];

  let killedAny = false;
  for (const p of procs) {
    if (
      allWorkerScripts.includes(p.filename) &&
      (p.filename !== scriptFilename || p.args[0] !== hackTarget)
    ) {
      ns.kill(p.pid);
      killedAny = true;
    }
  }

  // 3. Skript kopieren, falls es nicht auf dem Zielserver existiert
  if (targetNode !== "home" && !ns.fileExists(scriptFilename, targetNode)) {
    ns.scp(scriptFilename, targetNode, "home");
  }

  // 4. Exakte RAM-Berechnung (Nachdem die alten Prozesse gekillt wurden!)
  const scriptCost = ns.getScriptRam(scriptFilename);
  if (scriptCost === 0) return;

  const maxRam = ns.getServerMaxRam(targetNode);
  const usedRam = ns.getServerUsedRam(targetNode);
  const actualFreeRam = maxRam - usedRam - ramBuffer;

  const threads = Math.floor(actualFreeRam / scriptCost);

  // 5. Starten
  if (threads > 0) {
    ns.exec(scriptFilename, targetNode, threads, hackTarget);
  }
}