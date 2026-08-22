import { NS } from "@ns";

interface ScriptList {
  // Observability
  perfMonitor: string;
  logger: string;
  //-------------------------

  // Finanz-Verwaltung
  financeDispatcher?: string;
  financeCore: string;
  //-------------------------

  // Hacking-Payloads
  worker: string;
  hack: string;
  grow: string;
  weaken: string;
  //-------------------------

  // Orchestrator
  sysOrchestrator: string;

  // Batcher
  hackingOrchestrator: string;
  //-------------------------

  // Share
  fillShare: string;
  //-------------------------

  // Kontrakte
  cctSolver: string;

  // Darknet
  dnet: string;
  crawler: string;
  //-------------------------

  // Singularity
  sysDispatcher: string;
  backdoor: string;
  augAnalyze: string;
  //-------------------------

  // Sleeve
  sleeve: string;
  //-------------------------

  // Gang
  gang: string;
  //-------------------------

  // Hacknet
  hashManager: string;
  //-------------------------
}

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
