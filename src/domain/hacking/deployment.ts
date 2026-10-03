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
export async function deployWorker(
  ns: NS,
  targetNode: string,
  scriptFilename: string,
  hackTarget: string,
  ramBuffer: number,
  scripts: ScriptList,
): Promise<void> {
  // 1. Quellcode-Validierung
  if (!ns.fileExists(scriptFilename, "home")) {
    ns.print(`[DEPLOYMENT] Worker-Skript fehlt auf home: ${scriptFilename}`);
    return;
  }

  // 2. Skript bereitstellen, bevor bestehende Worker beendet werden.
  if (
    targetNode !== "home" &&
    !ns.fileExists(scriptFilename, targetNode)
  ) {
    const copied = await ns.scp(scriptFilename, targetNode, "home");
    if (!copied || !ns.fileExists(scriptFilename, targetNode)) {
      ns.print(
        `[DEPLOYMENT] Worker-Skript konnte nicht auf ${targetNode} bereitgestellt werden: ${scriptFilename}`,
      );
      return;
    }
  }

  // 3. Alte Prozesse identifizieren und restlos terminieren
  const procs = ns.ps(targetNode);
  const allWorkerScripts = [
    scripts.worker,
    scripts.hack,
    scripts.grow,
    scripts.weaken,
  ];

  for (const p of procs) {
    if (
      allWorkerScripts.includes(p.filename) &&
      (p.filename !== scriptFilename || p.args[0] !== hackTarget)
    ) {
      ns.kill(p.pid);
    }
  }

  // 4. Exakte RAM-Berechnung (Nachdem die alten Prozesse gekillt wurden!)
  const scriptCost = ns.getScriptRam(scriptFilename);
  if (!Number.isFinite(scriptCost) || scriptCost <= 0) {
    ns.print(`[DEPLOYMENT] Ungültiger RAM-Verbrauch für ${scriptFilename}.`);
    return;
  }

  const maxRam = ns.getServerMaxRam(targetNode);
  const usedRam = ns.getServerUsedRam(targetNode);
  const actualFreeRam = maxRam - usedRam - ramBuffer;

  const threads = Math.floor(actualFreeRam / scriptCost);

  // 5. Starten
  if (threads > 0) {
    const pid = ns.exec(scriptFilename, targetNode, threads, hackTarget);
    if (pid <= 0) {
      ns.print(
        `[DEPLOYMENT] Worker-Start fehlgeschlagen auf ${targetNode} für ${hackTarget}.`,
      );
    }
  }
}
