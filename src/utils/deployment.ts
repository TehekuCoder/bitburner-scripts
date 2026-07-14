import { NS } from "@ns";
import { provisionServer } from "../utils/provision.js";
import { ScriptList } from "../core/sys-kernel.js";

/**
 * Verteilt Worker-Skripte auf einem Ziel-Server und maximiert die Thread-Auslastung.
 */
export async function deployWorker(
  ns: NS,
  targetNode: string,
  scriptFilename: string,
  hackTarget: string,
  ramBuffer: number,
  scripts: ScriptList,
): Promise<void> {
  if (targetNode !== "home") {
    await provisionServer(ns, targetNode);
  }

  if (!ns.fileExists(scriptFilename, "home")) return;

  const scriptCost = ns.getScriptRam(scriptFilename);
  const maxRam = ns.getServerMaxRam(targetNode);
  const usedRam = ns.getServerUsedRam(targetNode);
  let freedRam = 0;

  const procs = ns.ps(targetNode);
  const allWorkerScripts = [
    scripts.worker,
    scripts.xpfarm,
    scripts.hack,
    scripts.grow,
    scripts.weaken,
  ];

  // Alte Worker auf diesem Server beenden, falls das Ziel oder die Strategie gewechselt hat
  for (const p of procs) {
    if (
      allWorkerScripts.includes(p.filename) &&
      (p.filename !== scriptFilename || p.args[0] !== hackTarget)
    ) {
      ns.kill(p.pid);
      freedRam += ns.getScriptRam(p.filename) * p.threads;
    }
  }

  const actualFreeRam = maxRam - usedRam + freedRam - ramBuffer;
  const threads = Math.floor(actualFreeRam / scriptCost);

  if (threads > 0) {
    ns.exec(scriptFilename, targetNode, threads, hackTarget);
  }
}