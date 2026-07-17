import { NS } from "@ns";
import { BatchPlan, WorkerNode } from "./types"; // Typen aus deiner zentralen types.ts

/**
 * Verteilt einen kompletten HWGW-Batch atomar und transaktionssicher über das Netzwerk.
 *
 * @param ns Die Netscript-Umgebung
 * @param plan Der berechnete BatchPlan
 * @param workers Array der verfügbaren Worker mit bereits berechnetem, freiem RAM
 * @param batchId Die eindeutige ID dieses Batches für das Late-Game-Tracing
 */
export function dispatchSplitBatch(
  ns: NS,
  plan: BatchPlan,
  workers: WorkerNode[],
  batchId: number,
): boolean {
  // 1. All-or-Nothing Vorab-Check
  const totalFreeRam = workers.reduce((sum, w) => sum + w.freeRam, 0);
  if (totalFreeRam < plan.totalRam) {
    ns.print(
      `[WARN] Batch #${batchId} abgebrochen: Zu wenig Netzwerk-RAM (${ns.format.ram(totalFreeRam)} verfügbar, ${ns.format.ram(plan.totalRam)} benötigt).`,
    );
    return false;
  }

// In core/batch-dispatcher.ts
const tasks = [
  {
    script: "tasks/hack.js",
    threads: plan.hackThreads ?? 0,
    delay: plan.hackDelay ?? 0,
  },
  {
    script: "tasks/weaken.js",
    threads: plan.weaken1Threads ?? 0,
    delay: plan.weaken1Delay ?? 0,
  },
  {
    script: "tasks/grow.js",
    threads: plan.growThreads ?? 0,
    delay: plan.growDelay ?? 0,
  },
  {
    script: "tasks/weaken.js",
    threads: plan.weaken2Threads ?? 0, // Falls hier der Typen-Dreher liegt, wird es jetzt zu 0...
    delay: plan.weaken2Delay ?? 0,
  },
];

  // RAM-Kosten der Skripte dynamisch ermitteln und cachen
  const ramCosts: Record<string, number> = {
    "tasks/hack.js": ns.getScriptRam("tasks/hack.js"),
    "tasks/grow.js": ns.getScriptRam("tasks/grow.js"),
    "tasks/weaken.js": ns.getScriptRam("tasks/weaken.js"),
  };

  // Lokale Kopie der Worker-RAM-Stände für die transaktionssichere Planung
  const localWorkers = workers.map((w) => ({ ...w }));
  const deployedPids: { pid: number; host: string }[] = [];

  // 2. Iteratives Deployment der Tasks
  for (const task of tasks) {
    let threadsLeft = task.threads;
    const scriptRam = ramCosts[task.script];

    if (threadsLeft <= 0) continue;

    for (const worker of localWorkers) {
      if (threadsLeft <= 0) break;

      const possibleThreads = Math.floor(worker.freeRam / scriptRam);
      if (possibleThreads <= 0) continue;

      const toDeploy = Math.min(possibleThreads, threadsLeft);

      // 🟢 AUTO-SCP (aus sys-batcher): Skript bei Bedarf auf den Worker kopieren
      if (
        worker.hostname !== "home" &&
        !ns.fileExists(task.script, worker.hostname)
      ) {
        ns.scp(task.script, worker.hostname, "home");
        ns.print(
          `💾 Auto-SCP: '${task.script}' auf '${worker.hostname}' kopiert.`,
        );
      }

      // Skript starten (Argumente passend für deine Worker-Typen!)
      const pid = ns.exec(
        task.script,
        worker.hostname,
        toDeploy,
        plan.target,
        task.delay as unknown as string, // 🟢 Trickst TS aus, bleibt im JS eine echte Zahl!
        batchId as unknown as string, // 🟢 ID bleibt ebenfalls eine Zahl
        Math.random() as unknown as string, // 🟢 Random-Seed bleibt eine Zahl
      );

      if (pid > 0) {
        worker.freeRam -= toDeploy * scriptRam;
        threadsLeft -= toDeploy;
        deployedPids.push({ pid, host: worker.hostname });
      } else {
        // Rollback einleiten, falls ein exec fehlschlägt
        ns.print(
          `🚨 CRITICAL: exec von ${task.script} auf ${worker.hostname} fehlgeschlagen! Starte Rollback...`,
        );
        for (const deployed of deployedPids) {
          ns.kill(deployed.pid);
        }
        return false;
      }
    }

    // Falls am Ende einer Phase noch Threads übrig sind, obwohl der Vorab-Check grün war (z.B. durch RAM-Fragmentierung)
    if (threadsLeft > 0) {
      ns.print(
        `🚨 CRITICAL: RAM-Schnittstellen-Fehler! ${threadsLeft} Threads von ${task.script} konnten nicht platziert werden. Starte Rollback...`,
      );
      for (const deployed of deployedPids) {
        ns.kill(deployed.pid);
      }
      return false;
    }
  }

  // 3. Erfolg! Erst jetzt schreiben wir das verbrauchte RAM in die echten Worker-Referenzen zurück
  for (let i = 0; i < workers.length; i++) {
    workers[i].freeRam = localWorkers[i].freeRam;
  }

  return true;
}
